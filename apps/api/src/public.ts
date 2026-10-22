import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./db/client.ts";
import { candidates, jobs, organizations } from "./db/schema.ts";
import { EMAIL_PATTERN } from "./cv-profile.ts";

// Everything the public job page may show. No org id, no internal ids, no plan usage.
export type PublicJob = {
	slug: string;
	title: string;
	description: string;
	status: "open" | "closed";
	company: string;
	createdAt: Date;
	hasCover: boolean;
};

// What the apply endpoint needs and the page must never see.
export type ApplyTarget = { id: string; orgId: string; status: "open" | "closed" };

export const SITEMAP_MAX = 1000;
export const EMAIL_MAX = 254;

// Drafts are private: a draft's slug looks exactly like an unknown one.
const visible = (slug: string) => and(eq(jobs.slug, slug), inArray(jobs.status, ["open", "closed"]));

export async function getPublicJob(db: Db, slug: string): Promise<PublicJob | null> {
	const [row] = await db
		.select({
			slug: jobs.slug,
			title: jobs.title,
			description: jobs.description,
			status: jobs.status,
			company: organizations.name,
			createdAt: jobs.createdAt,
			coverKey: jobs.coverKey,
		})
		.from(jobs)
		.innerJoin(organizations, eq(organizations.id, jobs.orgId))
		.where(visible(slug))
		.limit(1);
	if (!row) return null;
	const { coverKey, ...rest } = row;
	return { ...rest, slug, status: row.status as "open" | "closed", hasCover: coverKey !== null };
}

export async function getApplyTarget(db: Db, slug: string): Promise<ApplyTarget | null> {
	const [row] = await db.select({ id: jobs.id, orgId: jobs.orgId, status: jobs.status }).from(jobs).where(visible(slug)).limit(1);
	return row ? { ...row, status: row.status as "open" | "closed" } : null;
}

export async function getCoverKey(db: Db, slug: string): Promise<string | null> {
	const [row] = await db.select({ coverKey: jobs.coverKey }).from(jobs).where(visible(slug)).limit(1);
	return row?.coverKey ?? null;
}

export function listOpenJobSlugs(db: Db): Promise<{ slug: string; updatedAt: Date }[]> {
	return db
		.select({ slug: sql<string>`${jobs.slug}`, updatedAt: jobs.updatedAt })
		.from(jobs)
		.where(eq(jobs.status, "open"))
		.orderBy(desc(jobs.updatedAt))
		.limit(SITEMAP_MAX);
}

// An address as typed, tidied for storage: trimmed and lower case, or null when it isn't an email. The same rule as
// an email read from a CV, so a typed address can't add a recipient or a query to the recruiter's mailto: link.
export function normalizeEmail(raw: string | undefined | null): string | null {
	const email = raw?.trim().toLowerCase();
	if (!email || email.length > EMAIL_MAX) return null;
	return EMAIL_PATTERN.test(email) ? email : null;
}

export async function hasApplied(db: Db, jobId: string, email: string): Promise<boolean> {
	const [row] = await db
		.select({ id: candidates.id })
		.from(candidates)
		.where(and(eq(candidates.jobId, jobId), eq(candidates.email, email)))
		.limit(1);
	return Boolean(row);
}

export type CaptchaVerifier = (env: Env, token: string, ip: string | undefined) => Promise<boolean>;

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const CAPTCHA_HOSTNAMES = ["lucidhire.io", "localhost"];
// Cloudflare's always-pass test secret, used in local dev, answers for the made-up host example.com.
const TEST_SECRET_PREFIX = "1x0000000000000000000000000000000";

// Asks Cloudflare whether a Turnstile token is genuine and was issued on one of our own pages. Any failure to
// reach Cloudflare counts as a failed check.
export const verifyTurnstile: CaptchaVerifier = async (env, token, ip) => {
	const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
	if (ip) form.set("remoteip", ip);
	try {
		const res = await fetch(SITEVERIFY_URL, { method: "POST", body: form, signal: AbortSignal.timeout(5000) });
		if (!res.ok) return false;
		const result = (await res.json()) as { success?: boolean; hostname?: string };
		const hostnames = env.TURNSTILE_SECRET_KEY.startsWith(TEST_SECRET_PREFIX)
			? [...CAPTCHA_HOSTNAMES, "example.com"]
			: CAPTCHA_HOSTNAMES;
		return result.success === true && hostnames.includes(result.hostname ?? "");
	} catch {
		return false;
	}
};
