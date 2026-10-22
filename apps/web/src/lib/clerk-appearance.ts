import type { ClerkProvider } from "@clerk/react";
import type { ComponentProps } from "react";

type ProviderProps = ComponentProps<typeof ClerkProvider>;
type Appearance = NonNullable<ProviderProps["appearance"]>;
type Localization = NonNullable<ProviderProps["localization"]>;

// Clerk's sign-in, sign-up and account components in the Highlighter style (design system §4).
// Clerk's CSS sits in the `clerk` cascade layer (see index.css), so these classes win over it.
export const clerkAppearance: Appearance = {
	cssLayerName: "clerk",
	variables: {
		colorPrimary: "var(--ink)",
		colorPrimaryForeground: "var(--paper)",
		colorForeground: "var(--ink)",
		colorMutedForeground: "var(--ink-muted)",
		colorMuted: "var(--paper-2)",
		colorBackground: "var(--sheet)",
		colorInput: "var(--sheet)",
		colorInputForeground: "var(--ink)",
		colorNeutral: "var(--ink)",
		colorDanger: "var(--gap-ink)",
		colorBorder: "var(--line)",
		colorRing: "var(--ink)",
		colorModalBackdrop: "rgba(20,20,20,.5)",
		fontFamily: '"Archivo Variable", "Archivo", ui-sans-serif, system-ui, sans-serif',
		fontFamilyButtons: '"Archivo Variable", "Archivo", ui-sans-serif, system-ui, sans-serif',
		fontFamilyMono: '"Fragment Mono", ui-monospace, "SFMono-Regular", Menlo, monospace',
		borderRadius: "8px",
	},
	elements: {
		cardBox: "rounded-xl shadow-card",
		// The page header already carries the LucidHire logo.
		logoBox: "hidden",
		card: "bg-sheet",
		headerTitle: "font-display text-[24px] leading-[1.1] font-[800] tracking-[-0.02em] [font-stretch:110%] text-ink",
		headerSubtitle: "text-[15px] text-ink-muted",
		formFieldLabel: "text-[14px] font-semibold text-ink",
		formFieldInput: "min-h-11 rounded-md border-[1.5px] border-line bg-sheet text-[16px] text-ink",
		formFieldErrorText: "text-[13px] text-gap-ink",
		formButtonPrimary: "btn min-h-11 w-full shadow-none after:hidden",
		socialButtonsBlockButton: "min-h-11 rounded-md border-[1.5px] border-line shadow-none hover:bg-paper-2",
		dividerLine: "bg-line",
		footerActionLink: "font-semibold text-ink underline underline-offset-[.18em] hover:text-ink",
		// The avatar stays 36px; the button around it is a 44px touch target (design system §2.3).
		userButtonTrigger: "min-h-11 min-w-11 items-center justify-center",
		userButtonAvatarBox: "size-9",
	},
};

// Clerk's default copy names the app "Lucid Hire" and uses exclamation marks; the voice rules
// (design system §6) want the product name as one word and plain sentences.
export const clerkLocalization: Localization = {
	signIn: {
		start: {
			title: "Sign in to LucidHire",
			subtitle: "Use the email you signed up with.",
		},
	},
	signUp: {
		start: {
			title: "Create your LucidHire account",
			subtitle: "It takes a minute. No card needed.",
		},
		emailCode: {
			title: "Check your email",
			subtitle: "Enter the 6-digit code we sent to",
			resendButton: "Didn't get it? Send a new code",
		},
	},
};

// Sign-in and sign-up on their own pages (AuthLayout): the form sits flat on the paper instead of in a card. It keeps
// Clerk's centred alignment, so every later step (verify email, password, reset, two-factor) lines up the same way.
// Passed to <SignIn> and <SignUp>; it adds to the above.
export const authFormAppearance: Appearance = {
	elements: {
		rootBox: "w-full max-w-[400px]",
		// Clerk's card sits -1px over the box's border and the box clips, which cut off the fields' right edges and focus
		// rings once the border was gone, so the card keeps its place and the box shows what reaches past it.
		cardBox: "w-full max-w-none overflow-visible rounded-none border-0 bg-transparent shadow-none",
		card: "m-0 gap-7 rounded-none border-0 bg-transparent px-0 pt-0 pb-2 shadow-none",
		headerTitle: "text-[28px] [font-stretch:112%] tracking-[-0.03em]",
		footer: "bg-none bg-transparent px-0 [&>*]:px-0",
		footerAction: "text-[15px]",
		footerActionText: "text-ink-2",
		socialButtonsBlockButtonText: "text-[15px] font-semibold text-ink",
		// The email-code step. Clerk draws the six code boxes 40px square (32px on small screens) and caps them at 36px
		// tall in its own styles, so their size takes `!`. The row's wrapper is only as wide as its content, so the boxes
		// get a set width: 56 x 64px, narrowing with the screen so six fit at 360px. Digits are mono, the way the app
		// shows data, and the box being typed in keeps Clerk's ink focus ring. The email being verified is a mono chip,
		// and the resend link has room under the boxes.
		otpCodeFieldInputs: "gap-2",
		otpCodeFieldInput:
			"!h-[clamp(52px,15vw,64px)] !max-h-none !w-[clamp(44px,12.5vw,56px)] border-[1.5px] border-solid border-line bg-sheet font-mono !text-[26px] !font-normal text-ink",
		formResendCodeLink: "mt-2 text-[14px] text-ink-muted hover:text-ink",
		identityPreview: "mx-auto mt-1 w-fit gap-2 rounded-md border border-line bg-sheet px-3 py-1.5",
		identityPreviewText: "font-mono text-[13.5px] text-ink",
	},
};
