// `compact` is the mark alone, for the collapsed sidebar; the link around it carries the name.
export function Logo({ compact = false }: { compact?: boolean }) {
	return (
		<span className="inline-flex min-h-11 items-center gap-2.5 font-display text-[22px] leading-none font-[850] tracking-[-0.03em] text-ink [font-stretch:120%]">
			<svg className="size-[26px] flex-none" viewBox="0 0 26 26" aria-hidden="true">
				<rect width="26" height="26" rx="6" fill="#141414" />
				<path d="M6.5 7.5h9" stroke="#F5F5F1" strokeWidth="2" strokeLinecap="round" />
				<path d="M5.5 13h15" stroke="#FFE84A" strokeWidth="5.5" />
				<path d="M6.5 18.5h11" stroke="#F5F5F1" strokeWidth="2" strokeLinecap="round" />
			</svg>
			{!compact && (
				<span>
					Lucid<span className="mk mk-logo">Hire</span>
				</span>
			)}
		</span>
	);
}
