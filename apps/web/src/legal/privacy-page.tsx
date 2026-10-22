import { useDocumentTitle } from "../lib/use-document-title.ts";
import { PRIVACY_EMAIL, PRIVACY_MAILTO } from "../lib/site.ts";
import { Bullets, LegalLayout, type LegalSection, TextLink } from "./legal-layout.tsx";

const SECTIONS: LegalSection[] = [
	{
		id: "who",
		title: "Who we are",
		body: (
			<>
				<p>
					LucidHire is a service that reads CVs against a job and ranks the candidates, with the evidence behind
					every score. This page explains what personal data we handle, why, who else touches it, and what you
					can ask of us.
				</p>
				<p>
					We act in two roles. For the recruiters who sign up, we are the <strong>controller</strong> of their
					account data. For the people who apply for a job, we are a <strong>processor</strong>: the hiring
					company decides why a CV is read and what happens next, and we handle it on the company's behalf.
				</p>
			</>
		),
	},
	{
		id: "collect",
		title: "What we collect",
		body: (
			<>
				<p>Recruiter account data:</p>
				<Bullets
					items={[
						"Your name, email address and sign-in details, held by our sign-in provider.",
						"Your company name, the jobs you post and the notes and decisions you record.",
						"Your plan and billing status. Card details go to our payment provider and never reach us.",
					]}
				/>
				<p>Applicant data, uploaded by the hiring company:</p>
				<Bullets
					items={[
						"The CV file itself, and the text we read from it: contact details, work history, education and skills.",
						"The score, the requirement-by-requirement evidence and the summary we produce from it.",
						"The recruiter's decision and notes about that applicant.",
					]}
				/>
				<p>
					We do not run advertising or sell personal data. We do not build profiles of people across companies.
				</p>
			</>
		),
	},
	{
		id: "why",
		title: "Why we use it",
		body: (
			<>
				<p>We use personal data to:</p>
				<Bullets
					items={[
						"read a CV against the job's requirements and show the evidence for each score,",
						"write and improve job descriptions and interview questions when you ask us to,",
						"keep your account, plan and billing working, and keep the service secure,",
						"answer your messages and requests.",
					]}
				/>
				<p>
					For recruiter data our basis is the contract with you. For applicant data it is the hiring company's
					basis, usually its legitimate interest in assessing people who applied for a role. Companies must have
					a lawful basis before they upload a CV.
				</p>
			</>
		),
	},
	{
		id: "ai",
		title: "How the AI ranking works",
		body: (
			<>
				<p>
					The ranking is an aid to a human decision. It is never an automated decision: nobody is accepted or
					rejected by LucidHire. The recruiter reads the result, can open the original CV, and makes the call.
				</p>
				<p>
					Every score comes with its reasoning, requirement by requirement, with the evidence quoted from the CV
					or a note that the CV does not show it. The recruiter sees this reasoning. An applicant can ask for it
					through the hiring company, and we help the company provide it.
				</p>
			</>
		),
	},
	{
		id: "processors",
		title: "Who else handles your data",
		body: (
			<>
				<p>We use these providers to run the service. They handle data only for that purpose.</p>
				<Bullets
					items={[
						<>
							<strong>Cloudflare</strong> hosts the app and runs it: Workers for the code, D1 for the database,
							R2 for CV files, Workflows for the reading queue and Turnstile to tell people from bots.
						</>,
						<>
							<strong>Clerk</strong> handles sign-in and sessions.
						</>,
						<>
							<strong>Google (Gemini API)</strong> reads and scores CVs, and writes job descriptions and
							interview questions. The text we send is processed under the Gemini API terms.
						</>,
						<>
							<strong>Polar</strong> bills paid plans and is the merchant of record.
						</>,
					]}
				/>
				<p>
					Some of these providers process data outside your country, including in the United States. Where the law
					requires it, they rely on approved transfer terms.
				</p>
			</>
		),
	},
	{
		id: "retention",
		title: "How long we keep it, and deleting it",
		body: (
			<>
				<p>
					We keep data while your account is active. Deleting a candidate deletes their CV file, their scores and
					your notes about them. Deleting a job deletes all its candidates and their files. Deletion is permanent.
				</p>
				<p>
					If you close your account, write to us and we delete your company's data. Billing records are kept for as
					long as tax law requires. Backups and logs roll off on their normal schedule.
				</p>
			</>
		),
	},
	{
		id: "cookies",
		title: "Cookies and local storage",
		body: (
			<p>
				We do not use advertising or tracking cookies. Your sign-in provider, Clerk, sets its own session cookies so
				you stay signed in. Your preferences, such as the theme, are kept in your browser's local storage on your
				device, not in a cookie, and are never sent to us.
			</p>
		),
	},
	{
		id: "rights",
		title: "Your rights",
		body: (
			<>
				<p>
					You can ask to see, correct, export or delete your personal data, to object to how it is used, and to
					withdraw consent where we rely on it. If you applied for a job, the hiring company is who decides about
					your CV, so we pass your request to them and help them answer it.
				</p>
				<p>
					Write to <TextLink href={PRIVACY_MAILTO}>{PRIVACY_EMAIL}</TextLink>. We answer within 30 days. If you are
					not happy with the answer, you can complain to your local data protection authority.
				</p>
			</>
		),
	},
	{
		id: "security",
		title: "Security",
		body: (
			<p>
				Data is encrypted in transit and at rest on Cloudflare. CV files are private and opened only through
				short-lived links for signed-in members of the company that owns them. Each company sees only its own data.
				No system is perfectly secure, and if something goes wrong that affects you we will tell you promptly.
			</p>
		),
	},
	{
		id: "changes",
		title: "Changes and contact",
		body: (
			<p>
				If we change this page in a way that matters, we update the date at the top and tell account holders by email.
				Questions about privacy go to <TextLink href={PRIVACY_MAILTO}>{PRIVACY_EMAIL}</TextLink>.
			</p>
		),
	},
];

export function PrivacyPage() {
	useDocumentTitle("Privacy policy · LucidHire");

	return (
		<LegalLayout
			title="Privacy policy"
			lede="What we collect, who handles it, how long we keep it, and how to ask us to change it."
			sections={SECTIONS}
		/>
	);
}
