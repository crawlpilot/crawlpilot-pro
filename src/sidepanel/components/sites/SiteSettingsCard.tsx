/**
 * A site's settings in setup and on a recipe (`shared/sites/siteSettings.ts`): speed, page wait, and
 * what to do at a login page or an "are you human" check. Saved on every change, used by every run on
 * the site.
 */
import { useEffect, useState } from 'react';
import { Gauge } from 'lucide-react';
import { Button, Card, Segmented, Stepper, Text } from '../../ui';
import { PACES, setSiteSettings, siteRun, siteSettings, type Pace, type SiteSettings } from '../../../shared/sites/siteSettings';

const PACE_LABEL: Record<Pace, string> = { careful: 'Careful', normal: 'Normal', fast: 'Fast' };
const seconds = (ms: number) => `${ms % 1000 === 0 ? ms / 1000 : (ms / 1000).toFixed(1)} s`;

export function SiteSettingsCard({ site, className }: { site: string; className?: string }) {
    const [saved, setSaved] = useState<SiteSettings | undefined>();
    const [loaded, setLoaded] = useState(false);
    const [adjust, setAdjust] = useState(false);
    useEffect(() => {
        let live = true;
        setLoaded(false);
        void siteSettings(site).then(s => { if (live) { setSaved(s); setLoaded(true); } });
        return () => { live = false; };
    }, [site]);

    if (!site || !loaded) return null;
    const run = siteRun(saved);
    const save = (patch: Partial<SiteSettings>) => {
        // What the user sets replaces what a run learned.
        const next: SiteSettings = { ...saved, ...patch, learned: undefined };
        setSaved(next);
        void setSiteSettings(site, next);
    };
    const choosePace = (pace: Pace) => save({ pace, delayMs: undefined, tabs: undefined });

    return (
        <Card pad="sm" className={className} data-testid="site-settings">
            <div className="flex items-center gap-2">
                <Gauge size={15} className="text-ink-2" />
                <Text size="small" weight="semibold" className="min-w-0 flex-1" truncate>Site settings · {site}</Text>
                {saved && <Button size="sm" variant="ghost" onClick={() => { setSaved(undefined); void setSiteSettings(site, null); }}>Reset</Button>}
            </div>
            <Text size="caption" tone="muted" className="mt-0.5">Used for every run on this site, from any recipe.</Text>

            <div className="mt-3 flex flex-col gap-3">
                <div>
                    <Text size="caption" weight="medium" className="mb-1">Speed</Text>
                    <Segmented size="sm" fullWidth aria-label="Speed" value={run.pace} onChange={choosePace}
                        options={(['careful', 'normal', 'fast'] as const).map(p => ({ value: p, label: PACE_LABEL[p] }))} />
                    <div className="mt-1 flex items-center justify-between gap-2">
                        <Text size="caption" tone="muted">{seconds(run.delayMs)} between pages · {run.tabs} tab{run.tabs === 1 ? '' : 's'} at a time</Text>
                        <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-caption font-semibold text-accent" onClick={() => setAdjust(a => !a)}>
                            {adjust ? 'Done' : 'Adjust'}
                        </button>
                    </div>
                    {adjust && (
                        <div className="mt-2 flex flex-col gap-2">
                            <div className="flex items-center justify-between gap-3">
                                <Text size="caption">Between pages (ms)</Text>
                                <Stepper label="Between pages" value={run.delayMs} onChange={v => save({ delayMs: v })} min={0} max={30_000} step={250} />
                            </div>
                            <div className="flex items-center justify-between gap-3">
                                <Text size="caption">Tabs at a time</Text>
                                <Stepper label="Tabs at a time" value={run.tabs} onChange={v => save({ tabs: v })} min={1} max={5} width={1} />
                            </div>
                        </div>
                    )}
                    {saved?.learned && (
                        <Text size="caption" tone="warning" className="mt-1">Set to Careful after this site limited a run ({saved.learned.reason}).</Text>
                    )}
                </div>

                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <Text size="caption" weight="medium">Page wait</Text>
                        <Text size="caption" tone="muted">How long a page has to show its content</Text>
                    </div>
                    <Stepper label="Page wait (seconds)" value={Math.round(run.pageWaitMs / 1000)} onChange={v => save({ pageWaitMs: v * 1000 })} min={2} max={60} width={2} />
                </div>

                <div>
                    <Text size="caption" weight="medium" className="mb-1">A login page or an “are you human” check</Text>
                    <Segmented size="sm" fullWidth aria-label="Login or check" value={run.onWall} onChange={v => save({ onWall: v })}
                        options={[{ value: 'pause', label: 'Pause for me' }, { value: 'skip', label: 'Skip the page' }]} />
                </div>
            </div>
        </Card>
    );
}

/** The pace's values, for a sentence elsewhere ("Careful: 4 s between pages, 1 tab"). */
export const paceSummary = (pace: Pace) => `${PACE_LABEL[pace]}: ${seconds(PACES[pace].delayMs)} between pages, ${PACES[pace].tabs} tab${PACES[pace].tabs === 1 ? '' : 's'}`;
