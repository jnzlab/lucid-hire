import { Fragment } from "react";
import { HOTKEY_GROUPS, type ListedHotkey, useHotkeyList } from "../lib/hotkeys.ts";
import { Dialog } from "../ui/dialog.tsx";
import { Shortcut } from "../ui/kbd.tsx";

// Global first, then lists and the job triage keys, then anything a page added under its own heading.
function grouped(list: ListedHotkey[]) {
	const order = (group: string) => {
		const at = (HOTKEY_GROUPS as readonly string[]).indexOf(group);
		return at < 0 ? HOTKEY_GROUPS.length : at;
	};
	const groups = new Map<string, ListedHotkey[]>();
	for (const hotkey of list) groups.set(hotkey.group, [...(groups.get(hotkey.group) ?? []), hotkey]);
	return [...groups.entries()].sort(([a], [b]) => order(a) - order(b));
}

// The `?` sheet: every shortcut that works right now, read from the hotkey registry, so a page's own keys appear only
// while that page is open.
export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
	const list = useHotkeyList();
	return (
		<Dialog title="Keyboard shortcuts" size="md" onClose={onClose}>
			<div className="mt-5 flex flex-col gap-6">
				{grouped(list).map(([group, hotkeys]) => (
					<section key={group} aria-label={group}>
						<h3 className="pb-2 font-mono text-[12px] tracking-[.08em] text-ink-muted uppercase">{group}</h3>
						<dl className="flex flex-col">
							{hotkeys.map((hotkey) => (
								<div key={`${hotkey.label}-${hotkey.keys.join()}`} className="flex min-h-10 items-center justify-between gap-4 border-b border-line-2 py-1.5 last:border-b-0">
									<dt className="text-[15px] text-ink">{hotkey.label}</dt>
									<dd className="flex flex-none flex-wrap items-center justify-end gap-1.5">
										{hotkey.keys.map((keys, index) => (
											<Fragment key={keys}>
												{index > 0 && <span className="font-mono text-[11.5px] text-ink-muted">or</span>}
												<Shortcut keys={keys} />
											</Fragment>
										))}
									</dd>
								</div>
							))}
						</dl>
					</section>
				))}
				<p className="text-[14px] text-ink-muted">
					Lists and the job page add their own shortcuts while they're open. Shortcuts wait while you type in a field.
				</p>
			</div>
		</Dialog>
	);
}
