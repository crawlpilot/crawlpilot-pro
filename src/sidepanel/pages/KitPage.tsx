/**
 * Every kit component in its states (docs/plans/design-system-plan.md §3), at side-panel width.
 * Open with `?view=kit`; the toggle at the top flips light and dark. Design changes are checked here.
 */
import { useState, type ReactNode } from 'react';
import { ArrowRight, Download, Inbox, List, MoreVertical, Moon, Play, Search, Sparkles, Sun, Trash2 } from 'lucide-react';
import {
    Badge, Button, Card, CardButton, Checkbox, Chip, Collapse, Dialog, Disclosure, Divider, EmptyState, Heading, IconButton,
    Menu, MenuDivider, MenuItem, Notice, Progress, Radio, Row, Segmented, Select, Skeleton, Slider, Spinner, Stack, Switch, Text,
    TextArea, TextField, Tooltip,
} from '../ui';
import { applyMode } from '../theme/colorMode';

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="flex flex-col gap-3">
            <Heading size="label">{title}</Heading>
            {children}
        </section>
    );
}

export default function KitPage() {
    const [dark, setDark] = useState(document.documentElement.dataset.theme === 'dark');
    const [seg, setSeg] = useState<'light' | 'dark' | 'system'>('light');
    const [on, setOn] = useState(true);
    const [tick, setTick] = useState(true);
    const [radio, setRadio] = useState('a');
    const [pages, setPages] = useState(5);
    const [sel, setSel] = useState('csv');
    const [slider, setSlider] = useState(40);
    const [dialog, setDialog] = useState(false);
    const [menu, setMenu] = useState<HTMLElement | null>(null);
    const [open, setOpen] = useState(false);

    const flip = () => { setDark(!dark); applyMode(dark ? 'light' : 'dark'); };

    return (
        <div className="h-full overflow-y-auto bg-bg">
            <div className="flex flex-col gap-7 p-4 pb-10">
                <Row justify="between">
                    <Heading size="title">Kit</Heading>
                    <IconButton label={dark ? 'Light' : 'Dark'} variant="secondary" onClick={flip}>{dark ? <Sun /> : <Moon />}</IconButton>
                </Row>

                <Section title="Type">
                    <Heading size="display">24 products</Heading>
                    <Heading size="title">Get them as a table</Heading>
                    <Heading size="heading">Recent tables</Heading>
                    <Heading size="lead">A section lead</Heading>
                    <Text>Body text reads at 13.5 px so the panel stays easy on the eyes.</Text>
                    <Text size="small" tone="muted">Small, muted: hints and second lines.</Text>
                    <Text size="caption" tone="faint">Caption, faint: timestamps and meta.</Text>
                    <Text size="small" mono>div.product-card &gt; h3 a</Text>
                    <Text tone="accent" weight="semibold">Accent text that stays readable</Text>
                </Section>

                <Section title="Buttons">
                    <Row wrap>
                        <Button variant="primary" icon={<Play />}>Run</Button>
                        <Button variant="brand" iconEnd={<ArrowRight />}>Get started</Button>
                        <Button>Secondary</Button>
                        <Button variant="ghost">Ghost</Button>
                        <Button variant="danger" icon={<Trash2 />}>Delete</Button>
                    </Row>
                    <Row wrap>
                        <Button variant="primary" size="sm">Small</Button>
                        <Button variant="primary" size="lg">Large</Button>
                        <Button variant="primary" loading>Saving</Button>
                        <Button variant="primary" disabled>Disabled</Button>
                    </Row>
                    <Button variant="primary" size="lg" fullWidth icon={<Play />}>Get 24 products</Button>
                    <Row>
                        <IconButton label="Download"><Download /></IconButton>
                        <IconButton label="Search" variant="secondary"><Search /></IconButton>
                        <IconButton label="Pinned" active><Sparkles /></IconButton>
                        <IconButton label="More" size="sm"><MoreVertical /></IconButton>
                    </Row>
                </Section>

                <Section title="Cards and tiles">
                    <Card raised>
                        <Heading size="heading">24 products on this page</Heading>
                        <Text size="small" tone="muted" className="mt-1">Names, prices, ratings and links: 9 details each.</Text>
                        <Button variant="primary" className="mt-3" iconEnd={<ArrowRight />}>Get them as a table</Button>
                    </Card>
                    <div className="grid grid-cols-2 gap-2.5">
                        {(['lilac', 'sky', 'peach', 'mint'] as const).map(t => (
                            <CardButton key={t} tone={t} pad="sm">
                                <List size={20} />
                                <Text weight="semibold" className="mt-2">Tile {t}</Text>
                                <Text size="caption" tone="muted">One line of hint</Text>
                            </CardButton>
                        ))}
                    </div>
                    <Card tone="sunken" pad="sm"><Text size="small">A sunken well for secondary content.</Text></Card>
                    <Card tone="brand" pad="sm"><Text weight="semibold" tone="inherit">Done: 24 rows saved</Text></Card>
                </Section>

                <Section title="Chips">
                    <Row wrap>
                        <Chip>3 fields</Chip>
                        <Chip tone="brand">New</Chip>
                        <Chip tone="success">Ready</Chip>
                        <Chip tone="warning">Stopped</Chip>
                        <Chip tone="danger">Failed</Chip>
                        <Chip tone="info">Running</Chip>
                        <Chip tone="outline" onRemove={() => undefined}>price</Chip>
                        <Chip size="md" tone="neutral" icon={<Sparkles />}>AI</Chip>
                        <Badge>12</Badge>
                    </Row>
                </Section>

                <Section title="Fields">
                    <TextField label="Table name" placeholder="Walmart cars" hint="Shown in My data" />
                    <TextField placeholder="Search your data" start={<Search />} size="sm" />
                    <TextField label="Start URL" defaultValue="htp://broken" error="That doesn't look like a web address" />
                    <TextArea label="Selector" mono defaultValue="div.product-card" />
                    <Select label="Format" value={sel} onChange={setSel} options={[{ value: 'csv', label: 'CSV (spreadsheets)' }, { value: 'json', label: 'JSON' }, { value: 'xlsx', label: 'Excel' }]} />
                    <Text>Then click Next and get the next <Select inline value={pages} onChange={setPages} options={[1, 3, 5, 10].map(n => ({ value: n, label: String(n) }))} /> pages.</Text>
                </Section>

                <Section title="Choices">
                    <Segmented aria-label="Appearance" value={seg} onChange={setSeg} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' }]} />
                    <Segmented aria-label="Size" size="sm" fullWidth value={seg} onChange={setSeg} options={[{ value: 'light', label: 'One' }, { value: 'dark', label: 'Two' }, { value: 'system', label: 'Three' }]} />
                    <Switch checked={on} onChange={setOn} label="Skip duplicate rows" hint="Rows seen on an earlier page are left out" />
                    <Checkbox checked={tick} onChange={setTick} label="Include images" />
                    <Checkbox checked={false} indeterminate onChange={() => undefined} label="Some selected" />
                    <div role="radiogroup" className="flex flex-col gap-2">
                        <Radio name="r" checked={radio === 'a'} onChange={() => setRadio('a')} label="This page only" />
                        <Radio name="r" checked={radio === 'b'} onChange={() => setRadio('b')} label="Follow Next" hint="Up to the page limit" />
                    </div>
                    <Slider label="Wait between pages" valueLabel={`${slider / 10}s`} value={slider} onChange={setSlider} />
                </Section>

                <Section title="Feedback">
                    <Notice tone="info">The page is still loading its list.</Notice>
                    <Notice tone="success" title="24 rows saved">Open it in My data.</Notice>
                    <Notice tone="warning" title="Some pages were skipped" action={<Button size="sm">Show</Button>}>3 pages didn't load in time.</Notice>
                    <Notice tone="danger" onClose={() => undefined}>Couldn't reach the page.</Notice>
                    <Progress value={62} label="Progress" />
                    <Progress label="Loading" tone="ink" size="sm" />
                    <Row><Spinner /><Text size="small" tone="muted">Checking the page…</Text></Row>
                    <Stack gap={1.5}><Skeleton className="h-5 w-3/4" /><Skeleton className="h-9 w-40 rounded-control" /></Stack>
                </Section>

                <Section title="Overlays">
                    <Row wrap>
                        <Button onClick={() => setDialog(true)}>Open dialog</Button>
                        <Button icon={<MoreVertical />} onClick={e => setMenu(e.currentTarget)}>Menu</Button>
                        <Tooltip title="A tooltip, after a short wait"><Button variant="ghost">Hover me</Button></Tooltip>
                    </Row>
                    <Menu anchor={menu} onClose={() => setMenu(null)}>
                        <MenuItem icon={<Download />} onClick={() => setMenu(null)}>Download CSV</MenuItem>
                        <MenuItem icon={<Sparkles />} hint="⌘K" onClick={() => setMenu(null)}>Clean with AI</MenuItem>
                        <MenuItem selected onClick={() => setMenu(null)}>Current choice</MenuItem>
                        <MenuDivider />
                        <MenuItem icon={<Trash2 />} danger onClick={() => setMenu(null)}>Remove</MenuItem>
                    </Menu>
                    <Dialog open={dialog} onClose={() => setDialog(false)} title="Remove this table?" description="Walmart cars · 240 rows"
                        actions={<><Button variant="ghost" onClick={() => setDialog(false)}>Cancel</Button><Button variant="danger" onClick={() => setDialog(false)}>Remove</Button></>}>
                        <Text tone="muted">The rows are deleted from this browser. Downloads you already made stay.</Text>
                    </Dialog>
                </Section>

                <Section title="Disclosure">
                    <Disclosure summary="Advanced settings" meta="3 set">
                        <Text size="small" tone="muted">Hidden until opened, kept mounted.</Text>
                    </Disclosure>
                    <Disclosure variant="plain" summary="More tools" icon={<List />}>
                        <Text size="small">Plain variant, for a text row.</Text>
                    </Disclosure>
                    <Button variant="ghost" onClick={() => setOpen(!open)}>Toggle collapse</Button>
                    <Collapse open={open}><Card tone="sunken" pad="sm"><Text size="small">Collapsed content</Text></Card></Collapse>
                    <Divider />
                </Section>

                <Section title="Empty state">
                    <Card pad="none"><EmptyState icon={<Inbox />} title="Nothing saved yet" action={<Button variant="primary">Get a list</Button>}>Tables you make show up here.</EmptyState></Card>
                </Section>
            </div>
        </div>
    );
}
