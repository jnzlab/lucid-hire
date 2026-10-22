import { useDocumentTitle } from "../lib/use-document-title.ts";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "../lib/site.ts";
import { Bullets, LegalLayout, type LegalSection, TextLink } from "./legal-layout.tsx";

const SECTIONS: LegalSection[] = [
	{
		id: "agreement",
		title: "Using LucidHire",
		body: (
			<p>
				By creating an account or using LucidHire you agree to these terms for yourself and the company you act for.
				You must be old enough to form a contract where you live, and have the authority to bind your company. If you
				do not agree, do not use the service.
			</p>
		),
	},
	{
		id: "service",
		title: "What the service does",
		body: (
			<>
				<p>
					LucidHire reads the CVs you upload against the requirements of a job, scores each one, and shows the
					evidence behind every score. It can also write job descriptions and interview questions on request.
				</p>
				<p>
					The output is an aid to your judgement. It can be wrong. You are responsible for reading it, checking the
					CV where it matters, and for every hiring decision you make.
				</p>
			</>
		),
	},
	{
		id: "plans",
		title: "Plans and limits",
		body: (
			<>
				<Bullets
					items={[
						<>
							<strong>Free, $0:</strong> 10 CVs per job, 10 new jobs a UTC month, 30 AI requests an hour.
						</>,
						<>
							<strong>Pro, $10 a month:</strong> 100 CVs per job, 20 new jobs a UTC month, 150 AI requests an
							hour.
						</>,
						<>
							<strong>Max, $30 a month:</strong> 1,000 CVs per job, unlimited new jobs, 600 AI requests an hour.
						</>,
					]}
				/>
				<p>
					The service shows your usage and tells you when you reach a limit. We may change plans or prices for
					future periods, and tell you before a change reaches you.
				</p>
			</>
		),
	},
	{
		id: "billing",
		title: "Billing and cancelling",
		body: (
			<>
				<p>
					Paid plans are billed monthly in advance by Polar, who is the merchant of record and handles payment,
					invoices and tax. Payments are non-refundable.
				</p>
				<p>
					You can cancel at any time. A cancelled plan keeps running to the end of the period you paid for, then
					your account drops to Free. Data over the Free limits stays, but you cannot add to it until you are back
					under them or upgrade.
				</p>
			</>
		),
	},
	{
		id: "acceptable",
		title: "What you must not do",
		body: (
			<>
				<p>You agree not to:</p>
				<Bullets
					items={[
						"bypass or interfere with the CAPTCHA, rate limits or other protections,",
						"scrape the service or use it to build a competing one,",
						"use the output to make automated hiring decisions without a human reviewing them,",
						"upload CVs unless you have a lawful basis to process them,",
						"upload anything unlawful, or anything that harms the service or other people.",
					]}
				/>
				<p>We may suspend an account that breaks these rules.</p>
			</>
		),
	},
	{
		id: "content",
		title: "Your content and your data",
		body: (
			<>
				<p>
					You keep all rights to the jobs, CVs and notes you put into LucidHire. You give us permission to process
					them to run the service for you. Customer content is not used to train our models. It is sent to Google's
					Gemini API to be read and scored, and the Gemini API terms apply to that processing.
				</p>
				<p>
					For applicant data you are the one deciding why it is processed, and we act for you. How we handle it is
					set out in the privacy policy.
				</p>
			</>
		),
	},
	{
		id: "liability",
		title: "Liability",
		body: (
			<>
				<p>
					The service is provided as it is, without promises that it will always be available or error free. To the
					extent the law allows, we are not liable for indirect or lost profits, or for hiring decisions you make.
				</p>
				<p>
					Our total liability for any claim is limited to the fees you paid us in the 12 months before the claim.
					Nothing here limits liability that cannot be limited by law.
				</p>
			</>
		),
	},
	{
		id: "contact",
		title: "Changes and contact",
		body: (
			<p>
				If we change these terms in a way that matters, we update the date at the top and tell account holders by email
				before it applies. Questions, and any notice to us, go to <TextLink href={SUPPORT_MAILTO}>{SUPPORT_EMAIL}</TextLink>.
			</p>
		),
	},
];

export function TermsPage() {
	useDocumentTitle("Terms of service · LucidHire");

	return (
		<LegalLayout
			title="Terms of service"
			lede="The plain rules for using LucidHire: what you get, what it costs, and what we both agree to."
			sections={SECTIONS}
		/>
	);
}
