/**
 * The spec this follows describes emphasis tiers against a 0-100 percentile
 * score (90+ amber, 75-89 primary, below muted). The XGBoost ranker actually
 * returns small, unbounded floats -- every real score in this app sits
 * around 0.1-0.5 -- so hard-coding 90/75 would put every real result in the
 * bottom tier and misrepresent the model's own output as worse than it is.
 * The adapter: `emphasis` is decided by the caller from this result set's
 * own distribution (top rank = high, weakest = low), preserving the actual
 * intent -- the strongest match reads as strongest -- without inventing a
 * fake percentile scale on top of real numbers.
 */
export type ScoreEmphasis = "high" | "normal" | "low";

/**
 * Brand colour, not accent -- accent is reserved strictly for live/active
 * signals (a just-happened event, a live-status dot), and a ranked score
 * isn't one of those. The strongest match still reads as strongest: brand
 * for the top tier, ink for the middle, muted for the weakest.
 */
const TONE: Record<ScoreEmphasis, string> = {
  high: "text-brand",
  normal: "text-ink",
  low: "text-muted",
};

export function ScoreDisplay({
  score,
  similarity,
  emphasis = "normal",
}: {
  score: number;
  similarity?: number;
  emphasis?: ScoreEmphasis;
}) {
  return (
    <div className="text-right">
      <div className={`font-display text-2xl leading-none tabular-nums md:text-3xl ${TONE[emphasis]}`}>
        {score.toFixed(4)}
      </div>
      {similarity != null ? (
        <div className="mt-1 text-[11px] tracking-wide text-muted">
          COS <span className="tabular-nums">{similarity.toFixed(3)}</span>
        </div>
      ) : null}
    </div>
  );
}

/** Decide a row's tier from where its score sits in the current result set,
 *  not from an absolute threshold that doesn't apply to this model's scale. */
export function scoreEmphasis(score: number, index: number, allScores: number[]): ScoreEmphasis {
  if (index === 0) return "high";
  const max = Math.max(...allScores);
  const min = Math.min(...allScores);
  const span = max - min;
  if (span <= 0) return "normal";
  const position = (score - min) / span;
  return position < 0.15 ? "low" : "normal";
}
