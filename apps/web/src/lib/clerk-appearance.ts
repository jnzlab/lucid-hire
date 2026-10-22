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
	},
};
