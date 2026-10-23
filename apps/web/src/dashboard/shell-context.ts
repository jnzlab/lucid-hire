import { createContext, use } from "react";

export type ShellActions = {
	// Opens the command palette; "upload" starts at its "Upload CVs to…" step.
	openPalette: (step?: "root" | "upload") => void;
	openShortcuts: () => void;
	toggleSidebar: () => void;
	collapsed: boolean;
};

// The app shell's own actions, for the parts of it that live in separate components (the account menu, the More
// sheet) and for pages that want to open the palette or the shortcuts.
export const ShellContext = createContext<ShellActions | null>(null);

export function useShell(): ShellActions {
	const shell = use(ShellContext);
	if (!shell) throw new Error("useShell must be used inside the dashboard's app shell");
	return shell;
}
