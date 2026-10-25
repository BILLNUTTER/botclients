import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, ArrowRight, Bell, BriefcaseBusiness, Check, CircleAlert,
  CircleCheck, Clock3, Command, Copy, FileText, Filter, Globe2, LayoutDashboard, LifeBuoy,
  Link2, LogOut, Menu, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Server, Settings2,
  ShieldCheck, Sparkles, Trash2, UserRound, Users, X, Zap,
} from 'lucide-react';
import { Link, Redirect, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import {
  getGetAdminClientQueryKey, getGetAdminSummaryQueryKey, getGetClientProfileQueryKey,
  getGetCurrentUserQueryKey, getListAdminClientsQueryKey, getListAdminServicesQueryKey,
  getListAdminUpdatesQueryKey, getListServiceTypesQueryKey, useCreateAdminClient,
  useCreateAdminService, useCreateAdminUpdate, useCreateServiceType, useDeleteAdminClient,
  useDeleteAdminService, useDeleteAdminUpdate, useDeleteServiceType, useGetAdminClient,
  useGetAdminSummary, useGetClientProfile, useGetCurrentUser, useGetPublicUpdate,
  useListAdminClients, useListAdminServices, useListAdminUpdates, useListClientServices,
  useListClientUpdates, useListServiceTypes, useUpdateAdminClient, useUpdateAdminService,
  useUpdateAdminUpdate, useUpdateClientProfile, useUpdateServiceType,
  type AdminSummary, type Client, type CurrentUser, type Service, type ServiceType,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import './index.css';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const useAuth = () => ({ isSignedIn: false });
type IconType = typeof LayoutDashboard;
type Tone = 'orange' | 'dark' | 'green' | 'red' | 'sand';

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-3" data-testid="link-brand">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-white shadow-[3px_3px_0_#2b1a11]">
        <Zap size={19} strokeWidth={2.8} />
      </span>
      {!compact && <span className="display text-[15px] font-bold uppercase tracking-[-.06em]">Nutterx <span className="text-primary">Connect</span></span>}
    </Link>
  );
}

function PageLoader({ label = 'Loading workspace' }: { label?: string }) {
  return (
    <div className="flex min-h-[45vh] flex-col items-center justify-center gap-4 text-muted-foreground" data-testid="state-loading">
      <div className="size-8 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
      <span className="text-xs font-semibold uppercase tracking-[.16em]">{label}</span>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="surface mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl p-8 text-center" data-testid="state-error">
      <span className="grid size-11 place-items-center rounded-full bg-red-50 text-red-600"><CircleAlert size={21} /></span>
      <h3 className="display text-lg font-semibold">Could not load this view</h3>
      <p className="text-sm text-muted-foreground">The connection is taking a break. Try again in a moment.</p>
      {onRetry && <button onClick={onRetry} className="btn-secondary mt-2" data-testid="button-retry"><RefreshCw size={15} /> Retry</button>}
    </div>
  );
}

function EmptyState({ icon: Icon = FileText, title, copy, action }: { icon?: IconType; title: string; copy: string; action?: ReactNode }) {
  return (
    <div className="surface flex flex-col items-center justify-center rounded-2xl border-dashed p-10 text-center" data-testid="state-empty">
      <span className="mb-4 grid size-12 place-items-center rounded-2xl bg-accent text-primary"><Icon size={22} /></span>
      <h3 className="display text-lg font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{copy}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    active: { label: 'Active', cls: 'status-green' }, expiring_soon: { label: 'Expiring soon', cls: 'status-orange' },
    expired: { label: 'Expired', cls: 'status-red' }, inactive: { label: 'Inactive', cls: 'status-muted' },
    published: { label: 'Published', cls: 'status-green' }, draft: { label: 'Draft', cls: 'status-muted' },
    public: { label: 'Public', cls: 'status-orange' }, client_only: { label: 'Clients only', cls: 'status-dark' },
  };
  const item = map[status] ?? { label: status.replace('_', ' '), cls: 'status-muted' };
  return <span className={`status ${item.cls}`} data-testid={`status-${status}`}>{item.label}</span>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-[#24170f]/45 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" data-testid="modal">
      <div className="surface max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-2xl p-5 sm:p-7 rise-in">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div><div className="orange-rule mb-3" /><h2 className="display text-xl font-bold">{title}</h2></div>
          <button onClick={onClose} className="icon-button" aria-label="Close" data-testid="button-close-modal"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder, required = false, autoComplete }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; required?: boolean; autoComplete?: string }) {
  return <label className="grid gap-1.5 text-sm font-medium">{label}{required && <span className="text-primary"> *</span>}<input required={required} type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete={autoComplete} className="input" data-testid={`input-${label.toLowerCase().replaceAll(' ', '-')}`} /></label>;
}

function TextareaField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <label className="grid gap-1.5 text-sm font-medium">{label}<textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={4} className="input resize-none" data-testid={`textarea-${label.toLowerCase().replaceAll(' ', '-')}`} /></label>;
}

function PortalShell({ user, children }: { user?: CurrentUser; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isAdmin = user?.role === 'admin';
  const logout = async () => {
    await fetch('/api/admin/logout', { method: 'POST', credentials: 'include' });
    window.location.href = `${basePath}/?admin=true`;
  };
  const nav = isAdmin
    ? [
      { href: '/admin', label: 'Overview', icon: LayoutDashboard },
      { href: '/admin/clients', label: 'Clients', icon: Users },
      { href: '/admin/services', label: 'Services', icon: BriefcaseBusiness },
      { href: '/admin/service-types', label: 'Service types', icon: Server },
      { href: '/admin/updates', label: 'Announcements', icon: Bell },
    ]
    : [
      { href: '/client', label: 'My overview', icon: LayoutDashboard },
      { href: '/client/services', label: 'My services', icon: BriefcaseBusiness },
      { href: '/client/updates', label: 'Announcements', icon: Bell },
      { href: '/client/profile', label: 'Profile', icon: UserRound },
    ];
  const currentPath = window.location.pathname.replace(basePath, '') || '/';
  return (
    <div className="noise flex min-h-[100dvh] bg-background">
      <aside className={`fixed inset-y-0 left-0 z-30 flex w-[252px] flex-col bg-sidebar px-4 py-5 text-sidebar-foreground transition-transform duration-300 lg:translate-x-0 ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="mb-10 flex items-center justify-between px-2"><Brand /><button onClick={() => setMenuOpen(false)} className="icon-button text-sidebar-foreground/60 lg:hidden" data-testid="button-close-menu"><X size={18} /></button></div>
        <div className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[.2em] text-sidebar-foreground/40">{isAdmin ? 'Operations' : 'Account'}</div>
        <nav className="grid gap-1" aria-label="Primary navigation">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = currentPath === href || (href !== '/admin' && href !== '/client' && currentPath.startsWith(href));
            return <Link key={href} href={href} onClick={() => setMenuOpen(false)} className={`nav-item ${active ? 'nav-item-active' : ''}`} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`}><Icon size={17} /><span>{label}</span>{label === 'Announcements' && <span className="ml-auto size-1.5 rounded-full bg-primary" />}</Link>;
          })}
        </nav>
        <div className="mt-auto">
          <div className="mb-3 rounded-xl border border-sidebar-border bg-sidebar-foreground/[.04] p-3 text-xs text-sidebar-foreground/65"><ShieldCheck size={16} className="mb-2 text-primary" /><p className="font-semibold text-sidebar-foreground">Secure workspace</p><p className="mt-1 leading-relaxed">Your account and service details are protected.</p></div>
           <div className="flex items-center gap-3 border-t border-sidebar-border px-2 pt-4"><span className="grid size-9 place-items-center rounded-full bg-primary text-sm font-bold text-white">{(user?.name || 'N')[0]}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{user?.name || 'Portal user'}</p><p className="truncate text-[11px] text-sidebar-foreground/50">{user?.email || 'Account'}</p></div><button onClick={logout} className="text-sidebar-foreground/50 transition hover:text-white" aria-label="Sign out" data-testid="button-sign-out"><LogOut size={16} /></button></div>
        </div>
      </aside>
      {menuOpen && <button onClick={() => setMenuOpen(false)} className="fixed inset-0 z-20 bg-[#24170f]/30 lg:hidden" aria-label="Close navigation" data-testid="button-overlay-menu" />}
      <main className="min-w-0 flex-1 lg:pl-[252px]"><header className="sticky top-0 z-10 flex h-[68px] items-center justify-between border-b border-border/80 bg-background/90 px-4 backdrop-blur-md sm:px-8"><button className="icon-button lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Open navigation" data-testid="button-open-menu"><Menu size={20} /></button><div className="hidden text-xs font-medium text-muted-foreground sm:block"><span className="text-primary">NUTTERX</span><span className="mx-2">/</span>{isAdmin ? 'Operations' : 'Client portal'}</div><div className="ml-auto flex items-center gap-2"><Link href={isAdmin ? '/admin/updates' : '/client/updates'} className="icon-button relative" aria-label="Announcements" data-testid="link-header-updates"><Bell size={18} /><span className="absolute right-2 top-2 size-1.5 rounded-full bg-primary" /></Link><span className="mx-1 hidden h-6 w-px bg-border sm:block" /><span className="hidden text-right sm:block"><span className="block text-xs font-bold">{user?.name}</span><span className="block text-[10px] uppercase tracking-wider text-muted-foreground">{isAdmin ? 'Administrator' : 'Client'}</span></span><span className="grid size-8 place-items-center rounded-full bg-secondary text-xs font-bold text-foreground sm:hidden">{(user?.name || 'N')[0]}</span></div></header><div className="mx-auto max-w-[1440px] px-4 py-7 sm:px-8 lg:px-10">{children}</div></main>
    </div>
  );
}

function PageHeader({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy?: string; action?: ReactNode }) {
  return <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-primary"><span className="size-1.5 rounded-full bg-primary" />{eyebrow}</div><h1 className="display text-3xl font-bold tracking-[-.07em] sm:text-4xl">{title}</h1>{copy && <p className="mt-2 max-w-xl text-sm text-muted-foreground">{copy}</p>}</div>{action}</div>;
}

function MetricCard({ label, value, note, icon: Icon, tone = 'orange' }: { label: string; value: string | number; note: string; icon: IconType; tone?: Tone }) {
  return <div className="surface rise-in rounded-2xl p-5" data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`}><div className="mb-5 flex items-start justify-between"><span className={`metric-icon metric-${tone}`}><Icon size={18} /></span><span className="mono text-[10px] uppercase tracking-widest text-muted-foreground">Live</span></div><div className="display text-3xl font-bold">{value}</div><div className="mt-1 text-sm font-semibold">{label}</div><div className="mt-2 text-xs text-muted-foreground">{note}</div></div>;
}

function AdminHome() {
  const summaryQuery = useGetAdminSummary();
  const summary = summaryQuery.data as AdminSummary | undefined;
  if (summaryQuery.isLoading) return <PageLoader />;
  if (summaryQuery.isError || !summary) return <ErrorState onRetry={() => summaryQuery.refetch()} />;
  return <PortalPage eyebrow="Operations desk" title={`Good morning, keep things moving.`} copy="A quick read of the Nutterx Connect service network." action={<Link href="/admin/clients" className="btn-primary" data-testid="link-add-client"><Plus size={16} /> Add client</Link>}>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Total clients" value={summary.totalClients} note="Registered accounts" icon={Users} tone="dark" />
      <MetricCard label="Active services" value={summary.activeServices} note="Running right now" icon={Activity} tone="green" />
      <MetricCard label="Expiring soon" value={summary.expiringSoon} note="Needs a follow-up" icon={Clock3} tone="orange" />
      <MetricCard label="Expired services" value={summary.expiredServices} note="Requires attention" icon={CircleAlert} tone="red" />
    </div>
    <div className="mt-6 grid gap-6 xl:grid-cols-[1.15fr_.85fr]">
      <section className="surface rounded-2xl p-5 sm:p-6"><div className="mb-5 flex items-center justify-between"><div><p className="eyebrow">Priority queue</p><h2 className="display mt-1 text-xl font-bold">What needs your eye</h2></div><Link href="/admin/services" className="text-xs font-bold text-primary hover:underline" data-testid="link-view-services">View services <ArrowRight size={13} className="inline" /></Link></div>{summary.attentionItems.length === 0 ? <EmptyState icon={CircleCheck} title="All clear for now" copy="No services need immediate attention." /> : <div className="grid gap-2">{summary.attentionItems.slice(0, 6).map((item) => <Link href={`/admin/clients/${item.service.clientId}`} key={item.service.id} className="attention-row" data-testid={`link-attention-${item.service.id}`}><span className={`attention-dot ${item.service.status === 'expired' ? 'bg-red-500' : 'bg-primary'}`} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{item.service.clientName}</span><span className="block truncate text-xs text-muted-foreground">{item.service.serviceName} · {item.reason}</span></span><span className="text-xs font-bold text-primary">{item.service.daysRemaining === null ? '—' : `${item.service.daysRemaining}d`}</span><ArrowRight size={15} className="text-muted-foreground" /></Link>)}</div>}</section>
      <section className="surface rounded-2xl p-5 sm:p-6"><div className="mb-5 flex items-center justify-between"><div><p className="eyebrow">Bulletin</p><h2 className="display mt-1 text-xl font-bold">Recent updates</h2></div><Link href="/admin/updates" className="icon-button" aria-label="Manage announcements" data-testid="link-manage-updates"><MoreHorizontal size={18} /></Link></div>{summary.recentUpdates.length === 0 ? <EmptyState icon={Bell} title="No announcements yet" copy="Published updates will appear here." /> : <div className="grid gap-1">{summary.recentUpdates.slice(0, 5).map((update) => <Link href={`/updates/${update.slug}`} key={update.id} className="update-row" data-testid={`link-update-${update.id}`}><span className="grid size-8 place-items-center rounded-lg bg-accent text-primary"><FileText size={15} /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{update.title}</span><span className="block text-[11px] text-muted-foreground">{formatDate(update.publishedAt || update.createdAt)}</span></span><ArrowRight size={14} className="text-muted-foreground" /></Link>)}</div>}</section>
    </div>
    <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border pt-5 text-xs text-muted-foreground"><span className="flex items-center gap-2"><span className="size-2 rounded-full bg-emerald-500" />Systems operational</span><span className="flex items-center gap-2"><Globe2 size={14} />Kenya service region</span><span className="ml-auto mono">Last synced just now</span></div>
  </PortalPage>;
}

function PortalPage({ eyebrow, title, copy, action, children }: { eyebrow: string; title: string; copy?: string; action?: ReactNode; children: ReactNode }) {
  return <><PageHeader eyebrow={eyebrow} title={title} copy={copy} action={action} />{children}</>;
}

function ClientTable({ clients, onDelete }: { clients: Client[]; onDelete: (id: string) => void }) {
  if (!clients.length) return <EmptyState icon={Users} title="No clients match that search" copy="Try a different name, location, or status." />;
  return <div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Client</th><th>Contact</th><th>Services</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{clients.map((client) => <tr key={client.id} data-testid={`row-client-${client.id}`}><td><Link href={`/admin/clients/${client.id}`} className="flex items-center gap-3 font-bold hover:text-primary" data-testid={`link-client-${client.id}`}><span className="avatar">{initials(client.fullName)}</span><span><span className="block">{client.fullName}</span><span className="mono mt-0.5 block text-[10px] font-normal text-muted-foreground">{client.clientId}</span></span></Link></td><td><span className="block">{client.phone}</span><span className="block text-xs text-muted-foreground">{client.email}</span></td><td><span className="mono font-bold">{client.serviceCount}</span><span className="ml-1 text-xs text-muted-foreground">services</span></td><td><StatusPill status={client.status} /></td><td><button onClick={() => onDelete(client.id)} className="icon-button text-muted-foreground hover:text-red-600" aria-label={`Delete ${client.fullName}`} data-testid={`button-delete-client-${client.id}`}><Trash2 size={15} /></button></td></tr>)}</tbody></table></div>;
}

function AdminClients() {
  const query = useListAdminClients();
  const del = useDeleteAdminClient();
  const qc = useQueryClient();
  const [search, setSearch] = useState(''); const [filter, setFilter] = useState('all'); const [open, setOpen] = useState(false);
  const clients = useMemo(() => (query.data || []).filter((c) => `${c.fullName} ${c.clientId} ${c.email} ${c.location || ''}`.toLowerCase().includes(search.toLowerCase())).filter((c) => filter === 'all' || c.status === filter), [query.data, search, filter]);
  const deleteClient = (id: string) => { if (window.confirm('Remove this client account?')) del.mutate({ id }, { onSuccess: () => qc.invalidateQueries({ queryKey: getListAdminClientsQueryKey() }) }); };
  if (query.isLoading) return <PageLoader />;
  if (query.isError) return <ErrorState onRetry={() => query.refetch()} />;
  return <PortalPage eyebrow="Directory" title="Clients" copy={`${query.data?.length || 0} accounts in your service network.`} action={<button onClick={() => setOpen(true)} className="btn-primary" data-testid="button-new-client"><Plus size={16} /> New client</button>}>
    <div className="surface rounded-2xl p-4"><div className="flex flex-col gap-3 md:flex-row"><label className="relative flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, ID, email or location" className="input pl-10" data-testid="input-search-clients" /></label><div className="flex gap-2"><button onClick={() => setFilter('all')} className={`filter-button ${filter === 'all' ? 'filter-active' : ''}`} data-testid="button-filter-all"><Filter size={14} /> All</button><button onClick={() => setFilter('active')} className={`filter-button ${filter === 'active' ? 'filter-active' : ''}`} data-testid="button-filter-active">Active</button><button onClick={() => setFilter('inactive')} className={`filter-button ${filter === 'inactive' ? 'filter-active' : ''}`} data-testid="button-filter-inactive">Inactive</button></div></div><div className="mt-4"><ClientTable clients={clients} onDelete={deleteClient} /></div></div>
    {open && <ClientForm onClose={() => setOpen(false)} onDone={() => { setOpen(false); qc.invalidateQueries({ queryKey: getListAdminClientsQueryKey() }); }} />}
  </PortalPage>;
}

function ClientForm({ onClose, onDone, initial }: { onClose: () => void; onDone: () => void; initial?: Client }) {
  const mutation = useCreateAdminClient(); const update = useUpdateAdminClient();
  const [name, setName] = useState(initial?.fullName || ''); const [clientId, setClientId] = useState(initial?.clientId || ''); const [phone, setPhone] = useState(initial?.phone || ''); const [email, setEmail] = useState(initial?.email || ''); const [location, setLocation] = useState(initial?.location || ''); const [notes, setNotes] = useState(initial?.notes || '');
  const submit = (e: FormEvent) => { e.preventDefault(); if (initial) update.mutate({ id: initial.id, data: { fullName: name, phone, email, location, notes } }, { onSuccess: onDone }); else mutation.mutate({ data: { fullName: name, clientId, phone, email, location, notes, password: null } }, { onSuccess: onDone }); };
  return <Modal title={initial ? 'Edit client details' : 'Add a client'} onClose={onClose}><form onSubmit={submit} className="grid gap-4"><div className="grid gap-4 sm:grid-cols-2"><Field label="Full name" value={name} onChange={setName} required /><Field label="Phone" value={phone} onChange={setPhone} placeholder="+254 ..." required /></div>{!initial && <Field label="Client ID" value={clientId} onChange={setClientId} placeholder="e.g. NX-1042" required />}<Field label="Email" value={email} onChange={setEmail} type="email" required /><Field label="Location" value={location} onChange={setLocation} placeholder="Nairobi, Kenya" /><TextareaField label="Notes" value={notes} onChange={setNotes} placeholder="Internal context for the operations team" /><div className="mt-2 flex justify-end gap-2"><button type="button" onClick={onClose} className="btn-secondary" data-testid="button-cancel-client">Cancel</button><button disabled={mutation.isPending || update.isPending} className="btn-primary" data-testid="button-save-client">{mutation.isPending || update.isPending ? 'Saving…' : 'Save client'}</button></div></form></Modal>;
}

function AdminClientDetail() {
  const { id = '' } = useParams<{ id: string }>(); const query = useGetAdminClient(id); const [edit, setEdit] = useState(false); const [serviceOpen, setServiceOpen] = useState(false); const qc = useQueryClient();
  if (query.isLoading) return <PageLoader />; if (query.isError || !query.data) return <ErrorState onRetry={() => query.refetch()} />;
  const client = query.data;
  return <PortalPage eyebrow="Client record" title={client.fullName} copy={`${client.clientId} · Registered ${formatDate(client.registeredAt)}`} action={<div className="flex gap-2"><button onClick={() => setEdit(true)} className="btn-secondary" data-testid="button-edit-client"><Pencil size={15} /> Edit</button><button onClick={() => setServiceOpen(true)} className="btn-primary" data-testid="button-add-service"><Plus size={15} /> Add service</button></div>}>
    <div className="grid gap-6 xl:grid-cols-[.75fr_1.25fr]"><section className="grid content-start gap-4"><div className="surface rounded-2xl p-5"><div className="flex items-start gap-4"><span className="avatar avatar-lg">{initials(client.fullName)}</span><div><h2 className="display text-xl font-bold">{client.fullName}</h2><p className="mono mt-1 text-xs text-primary">{client.clientId}</p><div className="mt-3"><StatusPill status={client.status} /></div></div></div><div className="mt-6 grid gap-4 border-t border-border pt-5 text-sm"><InfoLine label="Email" value={client.email} /><InfoLine label="Phone" value={client.phone} /><InfoLine label="Location" value={client.location || 'Not added'} /></div></div><div className="surface rounded-2xl p-5"><p className="eyebrow">Internal note</p><p className="mt-3 text-sm leading-relaxed text-muted-foreground">{client.notes || 'No internal notes for this account.'}</p></div></section><section className="surface rounded-2xl p-5 sm:p-6"><div className="mb-5 flex items-center justify-between"><div><p className="eyebrow">Provisioned services</p><h2 className="display mt-1 text-xl font-bold">{client.services.length} services</h2></div><span className="mono text-xs text-muted-foreground">ID {client.id.slice(0, 8)}</span></div>{client.services.length ? <div className="grid gap-3">{client.services.map((service) => <ServiceCard key={service.id} service={service} admin onChange={() => qc.invalidateQueries({ queryKey: getGetAdminClientQueryKey(id) })} />)}</div> : <EmptyState icon={BriefcaseBusiness} title="No services yet" copy="Add the first service to start tracking this account." action={<button onClick={() => setServiceOpen(true)} className="btn-primary" data-testid="button-empty-add-service"><Plus size={15} /> Add service</button>} />}</section></div>
    {edit && <ClientForm initial={client} onClose={() => setEdit(false)} onDone={() => { setEdit(false); qc.invalidateQueries({ queryKey: getGetAdminClientQueryKey(id) }); }} />}{serviceOpen && <ServiceForm clientId={client.id} clientName={client.fullName} onClose={() => setServiceOpen(false)} onDone={() => { setServiceOpen(false); qc.invalidateQueries({ queryKey: getGetAdminClientQueryKey(id) }); }} />}
  </PortalPage>;
}

function InfoLine({ label, value }: { label: string; value: string }) { return <div className="flex justify-between gap-3"><span className="text-muted-foreground">{label}</span><span className="max-w-[65%] text-right font-semibold">{value}</span></div>; }

function ServiceCard({ service, admin = false, onChange }: { service: Service; admin?: boolean; onChange?: () => void }) {
  const del = useDeleteAdminService(); const update = useUpdateAdminService(); const [edit, setEdit] = useState(false);
  return <div className="rounded-xl border border-border bg-background p-4 transition hover:border-primary/40" data-testid={`card-service-${service.id}`}><div className="flex items-start gap-3"><span className={`service-mark ${service.status === 'active' ? 'service-mark-green' : service.status === 'expired' ? 'service-mark-red' : ''}`}><Server size={17} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-bold">{service.serviceName}</h3><StatusPill status={service.status} /></div><p className="mt-1 text-xs text-muted-foreground">{service.serviceTypeName}{admin ? ` · ${service.clientName}` : ''}</p></div>{admin && <div className="flex gap-1"><button onClick={() => setEdit(true)} className="icon-button" aria-label="Edit service" data-testid={`button-edit-service-${service.id}`}><Pencil size={14} /></button><button onClick={() => { if (window.confirm('Remove this service?')) del.mutate({ id: service.id }, { onSuccess: onChange }); }} className="icon-button text-muted-foreground hover:text-red-600" aria-label="Delete service" data-testid={`button-delete-service-${service.id}`}><Trash2 size={14} /></button></div>}</div><div className="mt-4 grid grid-cols-2 gap-4 border-t border-border pt-3"><div><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Expiry</p><p className={`mt-1 text-sm font-bold ${service.status === 'expired' ? 'text-red-600' : service.status === 'expiring_soon' ? 'text-primary' : ''}`}>{formatDate(service.endDate)}</p></div><div><p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Remaining</p><p className="mono mt-1 text-sm font-bold">{service.daysRemaining === null ? '—' : service.daysRemaining < 0 ? `${Math.abs(service.daysRemaining)}d overdue` : `${service.daysRemaining} days`}</p></div></div>{service.notes && <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">{service.notes}</p>}{edit && <ServiceForm initial={service} clientId={service.clientId} clientName={service.clientName} onClose={() => setEdit(false)} onDone={() => { setEdit(false); onChange?.(); }} />}</div>;
}

function ServiceForm({ onClose, onDone, clientId, clientName, initial }: { onClose: () => void; onDone: () => void; clientId: string; clientName: string; initial?: Service }) {
  const typesQuery = useListServiceTypes(); const create = useCreateAdminService(); const update = useUpdateAdminService();
  const [serviceTypeId, setServiceTypeId] = useState(initial?.serviceTypeId || ''); const [name, setName] = useState(initial?.serviceName || ''); const [start, setStart] = useState(initial?.startDate?.slice(0, 10) || ''); const [end, setEnd] = useState(initial?.endDate?.slice(0, 10) || ''); const [price, setPrice] = useState(initial?.price?.toString() || ''); const [notes, setNotes] = useState(initial?.notes || '');
  const submit = (e: FormEvent) => { e.preventDefault(); const data = { serviceTypeId, serviceName: name, startDate: start, endDate: end, price: price ? Number(price) : null, notes }; if (initial) update.mutate({ id: initial.id, data }, { onSuccess: onDone }); else create.mutate({ data: { ...data, clientId } }, { onSuccess: onDone }); };
  return <Modal title={initial ? 'Edit service' : `Add service for ${clientName}`} onClose={onClose}><form onSubmit={submit} className="grid gap-4"><label className="grid gap-1.5 text-sm font-medium">Service type<select value={serviceTypeId} onChange={(e) => setServiceTypeId(e.target.value)} className="input" required data-testid="select-service-type"><option value="">Select a type</option>{(typesQuery.data || []).filter((t) => t.active || t.id === initial?.serviceTypeId).map((type) => <option value={type.id} key={type.id}>{type.name}</option>)}</select></label><Field label="Service name" value={name} onChange={setName} required /><div className="grid gap-4 sm:grid-cols-2"><Field label="Start date" value={start} onChange={setStart} type="date" required /><Field label="End date" value={end} onChange={setEnd} type="date" required /></div><Field label="Price (KES)" value={price} onChange={setPrice} type="number" /><TextareaField label="Notes" value={notes} onChange={setNotes} /><div className="mt-2 flex justify-end gap-2"><button type="button" onClick={onClose} className="btn-secondary" data-testid="button-cancel-service">Cancel</button><button disabled={create.isPending || update.isPending} className="btn-primary" data-testid="button-save-service">{create.isPending || update.isPending ? 'Saving…' : 'Save service'}</button></div></form></Modal>;
}

function AdminServices() {
  const query = useListAdminServices(); const clientsQuery = useListAdminClients(); const qc = useQueryClient(); const [filter, setFilter] = useState('all'); const [search, setSearch] = useState(''); const [open, setOpen] = useState(false);
  const services = useMemo(() => (query.data || []).filter((s) => `${s.serviceName} ${s.clientName} ${s.serviceTypeName}`.toLowerCase().includes(search.toLowerCase())).filter((s) => filter === 'all' || s.status === filter), [query.data, search, filter]);
  if (query.isLoading) return <PageLoader />; if (query.isError) return <ErrorState onRetry={() => query.refetch()} />;
  return <PortalPage eyebrow="Operations" title="Services" copy="Track coverage, renewal windows, and every active provision." action={<button onClick={() => setOpen(true)} className="btn-primary" data-testid="button-new-service"><Plus size={16} /> New service</button>}><div className="surface rounded-2xl p-4"><div className="flex flex-col gap-3 md:flex-row"><label className="relative flex-1"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search services or clients" className="input pl-10" data-testid="input-search-services" /></label><div className="flex gap-2 overflow-auto"><button onClick={() => setFilter('all')} className={`filter-button ${filter === 'all' ? 'filter-active' : ''}`} data-testid="button-service-filter-all">All</button><button onClick={() => setFilter('active')} className={`filter-button ${filter === 'active' ? 'filter-active' : ''}`} data-testid="button-service-filter-active">Active</button><button onClick={() => setFilter('expiring_soon')} className={`filter-button ${filter === 'expiring_soon' ? 'filter-active' : ''}`} data-testid="button-service-filter-expiring">Expiring</button><button onClick={() => setFilter('expired')} className={`filter-button ${filter === 'expired' ? 'filter-active' : ''}`} data-testid="button-service-filter-expired">Expired</button></div></div><div className="mt-4 grid gap-3 md:grid-cols-2">{services.map((service) => <ServiceCard key={service.id} service={service} admin onChange={() => { qc.invalidateQueries({ queryKey: getListAdminServicesQueryKey() }); qc.invalidateQueries({ queryKey: getGetAdminSummaryQueryKey() }); }} />)}</div>{services.length === 0 && <div className="mt-4"><EmptyState icon={BriefcaseBusiness} title="No services found" copy="Adjust the filters or add a new service." /></div>}</div>{open && <ServiceForm clientId={(clientsQuery.data || [])[0]?.id || ''} clientName={(clientsQuery.data || [])[0]?.fullName || 'client'} onClose={() => setOpen(false)} onDone={() => { setOpen(false); qc.invalidateQueries({ queryKey: getListAdminServicesQueryKey() }); }} />}</PortalPage>;
}

function AdminServiceTypes() {
  const query = useListServiceTypes(); const create = useCreateServiceType(); const update = useUpdateServiceType(); const del = useDeleteServiceType(); const qc = useQueryClient(); const [open, setOpen] = useState(false); const [editing, setEditing] = useState<ServiceType | undefined>();
  const save = (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); const data = { name: String(f.get('name')), description: String(f.get('description') || '') }; if (editing) update.mutate({ id: editing.id, data }, { onSuccess: () => { setOpen(false); setEditing(undefined); qc.invalidateQueries({ queryKey: getListServiceTypesQueryKey() }); } }); else create.mutate({ data }, { onSuccess: () => { setOpen(false); qc.invalidateQueries({ queryKey: getListServiceTypesQueryKey() }); } }); };
  if (query.isLoading) return <PageLoader />; if (query.isError) return <ErrorState onRetry={() => query.refetch()} />;
  return <PortalPage eyebrow="Configuration" title="Service types" copy="Keep the catalogue tidy so every service has a clear home." action={<button onClick={() => { setEditing(undefined); setOpen(true); }} className="btn-primary" data-testid="button-new-service-type"><Plus size={16} /> Add type</button>}><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{(query.data || []).map((type) => <div className="surface rounded-2xl p-5" key={type.id} data-testid={`card-service-type-${type.id}`}><div className="flex items-start justify-between"><span className="grid size-10 place-items-center rounded-xl bg-accent text-primary"><Server size={18} /></span><div className="flex gap-1"><button onClick={() => { setEditing(type); setOpen(true); }} className="icon-button" aria-label={`Edit ${type.name}`} data-testid={`button-edit-service-type-${type.id}`}><Pencil size={14} /></button><button onClick={() => { if (window.confirm('Delete this service type?')) del.mutate({ id: type.id }, { onSuccess: () => qc.invalidateQueries({ queryKey: getListServiceTypesQueryKey() }) }); }} className="icon-button text-muted-foreground hover:text-red-600" aria-label={`Delete ${type.name}`} data-testid={`button-delete-service-type-${type.id}`}><Trash2 size={14} /></button></div></div><h3 className="mt-5 font-bold">{type.name}</h3><p className="mt-1 min-h-10 text-sm leading-relaxed text-muted-foreground">{type.description || 'No description added.'}</p><div className="mt-4 border-t border-border pt-3"><StatusPill status={type.active ? 'active' : 'inactive'} /></div></div>)}</div>{query.data?.length === 0 && <EmptyState icon={Server} title="No service types" copy="Create a type to organise your service catalogue." />}{open && <Modal title={editing ? 'Edit service type' : 'New service type'} onClose={() => setOpen(false)}><form onSubmit={save} className="grid gap-4"><label className="grid gap-1.5 text-sm font-medium">Name<input name="name" defaultValue={editing?.name} required className="input" data-testid="input-service-type-name" /></label><label className="grid gap-1.5 text-sm font-medium">Description<textarea name="description" defaultValue={editing?.description || ''} rows={4} className="input resize-none" data-testid="textarea-service-type-description" /></label><div className="flex justify-end gap-2"><button type="button" onClick={() => setOpen(false)} className="btn-secondary" data-testid="button-cancel-service-type">Cancel</button><button className="btn-primary" data-testid="button-save-service-type">Save type</button></div></form></Modal>}</PortalPage>;
}

function AdminUpdates() {
  const query = useListAdminUpdates(); const del = useDeleteAdminUpdate(); const qc = useQueryClient();
  if (query.isLoading) return <PageLoader />; if (query.isError) return <ErrorState onRetry={() => query.refetch()} />;
  return <PortalPage eyebrow="Communications" title="Announcements" copy="Keep clients in the loop with clear, timely updates." action={<Link href="/admin/updates/new" className="btn-primary" data-testid="link-new-update"><Plus size={16} /> Write update</Link>}><div className="surface overflow-hidden rounded-2xl"><div className="divide-y divide-border">{(query.data || []).map((update) => <div className="flex items-center gap-4 p-4 transition hover:bg-accent/40 sm:p-5" key={update.id} data-testid={`row-update-${update.id}`}><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-primary"><FileText size={18} /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><Link href={`/updates/${update.slug}`} className="truncate font-bold hover:text-primary" data-testid={`link-admin-update-${update.id}`}>{update.title}</Link><StatusPill status={update.publishStatus} /><StatusPill status={update.visibility} /></div><p className="mt-1 truncate text-xs text-muted-foreground">{formatDate(update.publishedAt || update.createdAt)} · /updates/{update.slug}</p></div><Link href={`/admin/updates/new?edit=${update.id}`} className="icon-button" aria-label="Edit update" data-testid={`link-edit-update-${update.id}`}><Pencil size={15} /></Link><button onClick={() => { if (window.confirm('Delete this announcement?')) del.mutate({ id: update.id }, { onSuccess: () => qc.invalidateQueries({ queryKey: getListAdminUpdatesQueryKey() }) }); }} className="icon-button text-muted-foreground hover:text-red-600" aria-label="Delete update" data-testid={`button-delete-update-${update.id}`}><Trash2 size={15} /></button></div>)}</div>{query.data?.length === 0 && <div className="p-4"><EmptyState icon={Bell} title="No announcements yet" copy="Write an update for clients or share something publicly." /></div>}</div></PortalPage>;
}

function UpdateEditor() {
  const [, setLocation] = useLocation(); const query = useListAdminUpdates(); const create = useCreateAdminUpdate(); const updateMut = useUpdateAdminUpdate(); const qc = useQueryClient();
  const editId = new URLSearchParams(window.location.search).get('edit'); const initial = query.data?.find((u) => u.id === editId);
  const [title, setTitle] = useState(initial?.title || ''); const [content, setContent] = useState(initial?.content || ''); const [imageUrl, setImageUrl] = useState(initial?.imageUrl || ''); const [linkUrl, setLinkUrl] = useState(initial?.linkUrl || ''); const [visibility, setVisibility] = useState<string>(initial?.visibility || 'public'); const [publishStatus, setPublishStatus] = useState<string>(initial?.publishStatus || 'draft');
  const save = (e: FormEvent) => { e.preventDefault(); const data = { title, content, imageUrl: imageUrl || null, linkUrl: linkUrl || null, visibility: visibility as 'public' | 'client_only', publishStatus: publishStatus as 'published' | 'draft' }; const done = () => { qc.invalidateQueries({ queryKey: getListAdminUpdatesQueryKey() }); setLocation('/admin/updates'); }; if (initial) updateMut.mutate({ id: initial.id, data }, { onSuccess: done }); else create.mutate({ data }, { onSuccess: done }); };
  if (editId && query.isLoading) return <PageLoader />;
  return <PortalPage eyebrow="Communications" title={initial ? 'Edit announcement' : 'Write an announcement'} copy="Be direct. Clients should understand what changed and what to do next." action={<button onClick={() => setLocation('/admin/updates')} className="btn-secondary" data-testid="button-cancel-update"><X size={15} /> Cancel</button>}><form onSubmit={save} className="grid gap-6 xl:grid-cols-[1fr_390px]"><div className="surface rounded-2xl p-5 sm:p-7"><div className="grid gap-5"><Field label="Title" value={title} onChange={setTitle} placeholder="e.g. Planned maintenance in Westlands" required /><TextareaField label="Message" value={content} onChange={setContent} placeholder="Write the update your clients need to read…" /><div className="grid gap-4 sm:grid-cols-2"><Field label="Image URL" value={imageUrl} onChange={setImageUrl} placeholder="Optional" /><Field label="Link URL" value={linkUrl} onChange={setLinkUrl} placeholder="https://…" /></div></div></div><aside className="grid content-start gap-4"><div className="surface rounded-2xl p-5"><p className="eyebrow">Publishing</p><div className="mt-4 grid gap-4"><label className="grid gap-1.5 text-sm font-medium">Audience<select value={visibility} onChange={(e) => setVisibility(e.target.value)} className="input" data-testid="select-update-visibility"><option value="public">Public</option><option value="client_only">Clients only</option></select></label><label className="grid gap-1.5 text-sm font-medium">Status<select value={publishStatus} onChange={(e) => setPublishStatus(e.target.value)} className="input" data-testid="select-update-status"><option value="draft">Draft</option><option value="published">Published</option></select></label><button disabled={create.isPending || updateMut.isPending || !title || !content} className="btn-primary mt-2 w-full justify-center" data-testid="button-publish-update">{publishStatus === 'published' ? <><Globe2 size={15} /> Publish update</> : <><FileText size={15} /> Save draft</>}</button></div></div><div className="surface rounded-2xl border-dashed p-5"><p className="eyebrow">Preview</p><div className="mt-4 rounded-xl bg-accent p-4"><p className="display text-lg font-bold">{title || 'Your update title'}</p><p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{content || 'Your message will appear here.'}</p></div></div></aside></form></PortalPage>;
}

function ClientHome() {
  const servicesQuery = useListClientServices(); const updatesQuery = useListClientUpdates(); const profileQuery = useGetClientProfile(); const services = servicesQuery.data || [];
  if (servicesQuery.isLoading || profileQuery.isLoading) return <PageLoader />;
  if (servicesQuery.isError || profileQuery.isError) return <ErrorState onRetry={() => { servicesQuery.refetch(); profileQuery.refetch(); }} />;
  const urgent = services.filter((s) => s.status !== 'active'); const active = services.filter((s) => s.status === 'active');
  return <PortalPage eyebrow="Client portal" title={`Hello, ${profileQuery.data?.fullName?.split(' ')[0] || 'there'}.`} copy="Here is the current view of your Nutterx Connect services." action={<Link href="/client/profile" className="btn-secondary" data-testid="link-client-profile"><Settings2 size={15} /> Account settings</Link>}><div className="surface relative overflow-hidden rounded-2xl bg-sidebar p-6 text-white sm:p-8"><div className="absolute -right-14 -top-20 size-64 rounded-full border-[30px] border-primary/20" /><div className="absolute -right-2 -top-8 size-36 rounded-full border-[18px] border-primary/20" /><p className="eyebrow text-primary">Service posture</p><div className="relative mt-2 flex flex-col justify-between gap-6 sm:flex-row sm:items-end"><div><h2 className="display text-2xl font-bold sm:text-3xl">{urgent.length ? `${urgent.length} service${urgent.length > 1 ? 's' : ''} need attention` : 'Everything is running smoothly'}</h2><p className="mt-2 max-w-md text-sm text-white/60">{urgent.length ? 'Check the expiry dates below and contact our team if you need help renewing.' : 'Your active services are within their current coverage period.'}</p></div><span className={`grid size-14 shrink-0 place-items-center rounded-2xl ${urgent.length ? 'bg-primary' : 'bg-emerald-500'} text-white`}>{urgent.length ? <Clock3 size={27} /> : <CircleCheck size={27} />}</span></div></div><div className="mt-6 grid gap-4 sm:grid-cols-3"><MetricCard label="My services" value={services.length} note={`${active.length} currently active`} icon={BriefcaseBusiness} tone="dark" /><MetricCard label="Active coverage" value={active.length} note="Services running" icon={CircleCheck} tone="green" /><MetricCard label="Needs attention" value={urgent.length} note="Review expiry dates" icon={Clock3} tone="orange" /></div><div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_.9fr]"><section className="surface rounded-2xl p-5 sm:p-6"><div className="mb-5 flex items-center justify-between"><div><p className="eyebrow">Coverage</p><h2 className="display mt-1 text-xl font-bold">Your services</h2></div><Link href="/client/services" className="text-xs font-bold text-primary hover:underline" data-testid="link-all-client-services">View all <ArrowRight size={13} className="inline" /></Link></div>{services.slice(0, 3).map((service) => <ServiceCard key={service.id} service={service} />)}{services.length === 0 && <EmptyState icon={BriefcaseBusiness} title="No services on this account" copy="If this looks unexpected, contact the Nutterx Connect team." />}</section><section className="surface rounded-2xl p-5 sm:p-6"><div className="mb-5 flex items-center justify-between"><div><p className="eyebrow">From the team</p><h2 className="display mt-1 text-xl font-bold">Latest updates</h2></div><Link href="/client/updates" className="icon-button" aria-label="View announcements" data-testid="link-client-updates"><ArrowRight size={16} /></Link></div>{(updatesQuery.data || []).slice(0, 4).map((update) => <Link href={`/updates/${update.slug}`} key={update.id} className="update-row" data-testid={`link-client-update-${update.id}`}><span className="grid size-8 place-items-center rounded-lg bg-accent text-primary"><Bell size={14} /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{update.title}</span><span className="block text-[11px] text-muted-foreground">{formatDate(update.publishedAt || update.createdAt)}</span></span><ArrowRight size={14} className="text-muted-foreground" /></Link>)}{updatesQuery.data?.length === 0 && <EmptyState icon={Bell} title="Quiet on the bulletin" copy="New client announcements will show here." />}</section></div></PortalPage>;
}

function ClientServices() { const query = useListClientServices(); if (query.isLoading) return <PageLoader />; if (query.isError) return <ErrorState onRetry={() => query.refetch()} />; return <PortalPage eyebrow="Client portal" title="My services" copy="Every service, its coverage window, and expiry date in one place."><div className="grid gap-3 lg:grid-cols-2">{(query.data || []).map((s) => <ServiceCard key={s.id} service={s} />)}</div>{!query.data?.length && <EmptyState icon={BriefcaseBusiness} title="No services found" copy="Your service list is empty right now." />}</PortalPage>; }
function ClientUpdates() { const query = useListClientUpdates(); if (query.isLoading) return <PageLoader />; if (query.isError) return <ErrorState onRetry={() => query.refetch()} />; return <PortalPage eyebrow="Client portal" title="Announcements" copy="Service notes and news from the Nutterx Connect team."><div className="grid gap-3">{(query.data || []).map((u) => <Link href={`/updates/${u.slug}`} key={u.id} className="surface flex gap-4 rounded-2xl p-5 transition hover:-translate-y-0.5 hover:border-primary/40" data-testid={`card-client-update-${u.id}`}><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent text-primary"><Bell size={19} /></span><span className="min-w-0 flex-1"><span className="block font-bold">{u.title}</span><span className="mt-1 block line-clamp-2 text-sm text-muted-foreground">{u.content}</span><span className="mt-3 block text-[11px] font-bold uppercase tracking-wider text-primary">{formatDate(u.publishedAt || u.createdAt)} <ArrowRight size={13} className="ml-1 inline" /></span></span></Link>)}{!query.data?.length && <EmptyState icon={Bell} title="No announcements" copy="There are no updates for your account yet." />}</div></PortalPage>; }
function ClientProfile() { const query = useGetClientProfile(); const mut = useUpdateClientProfile(); const qc = useQueryClient(); const [editing, setEditing] = useState(false); if (query.isLoading) return <PageLoader />; if (query.isError || !query.data) return <ErrorState onRetry={() => query.refetch()} />; const p = query.data; return <PortalPage eyebrow="Client portal" title="Profile" copy="Keep your contact details current so our team can reach you." action={!editing && <button onClick={() => setEditing(true)} className="btn-primary" data-testid="button-edit-profile"><Pencil size={15} /> Edit profile</button>}><div className="surface max-w-2xl rounded-2xl p-5 sm:p-7">{editing ? <form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); mut.mutate({ data: { phone: String(f.get('phone')), email: String(f.get('email')), location: String(f.get('location') || '') } }, { onSuccess: () => { setEditing(false); qc.invalidateQueries({ queryKey: getGetClientProfileQueryKey() }); } }); }} className="grid gap-4"><p className="text-sm text-muted-foreground">Edit your contact details below. We use them to keep your account up to date.</p><label className="grid gap-1.5 text-sm font-medium">Phone<input name="phone" defaultValue={p.phone} className="input" data-testid="input-profile-phone" /></label><label className="grid gap-1.5 text-sm font-medium">Email<input name="email" type="email" defaultValue={p.email} className="input" data-testid="input-profile-email" /></label><label className="grid gap-1.5 text-sm font-medium">Location<input name="location" defaultValue={p.location || ''} className="input" data-testid="input-profile-location" /></label><div className="flex justify-end gap-2"><button type="button" onClick={() => setEditing(false)} className="btn-secondary" data-testid="button-cancel-profile">Cancel</button><button className="btn-primary" data-testid="button-save-profile">{mut.isPending ? 'Saving…' : 'Save changes'}</button></div></form> : <><div className="flex items-center gap-4 border-b border-border pb-6"><span className="avatar avatar-lg">{initials(p.fullName)}</span><div><h2 className="display text-xl font-bold">{p.fullName}</h2><p className="mono mt-1 text-xs text-primary">{p.clientId}</p></div></div><div className="mt-6 grid gap-5"><InfoLine label="Email" value={p.email} /><InfoLine label="Phone" value={p.phone} /><InfoLine label="Location" value={p.location || 'Not added'} /></div></>}</div></PortalPage>; }

function PublicUpdate() { const { slug = '' } = useParams<{ slug: string }>(); const query = useGetPublicUpdate(slug); if (query.isLoading) return <PageLoader label="Loading announcement" />; if (query.isError || !query.data) return <ErrorState onRetry={() => query.refetch()} />; const u = query.data; return <div className="min-h-[100dvh] bg-background"><header className="flex h-[72px] items-center justify-between border-b border-border px-5 sm:px-10"><Brand /><Link href="/" className="text-xs font-bold text-muted-foreground hover:text-primary" data-testid="link-public-home">Back to portal <ArrowRight size={14} className="ml-1 inline" /></Link></header><main className="mx-auto max-w-3xl px-5 py-16 sm:px-8 sm:py-24"><div className="mb-6 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-primary"><Globe2 size={14} /> Nutterx Connect bulletin</div><h1 className="display max-w-3xl text-4xl font-bold leading-[.96] tracking-[-.08em] sm:text-6xl" data-testid="text-public-update-title">{u.title}</h1><p className="mt-5 text-sm text-muted-foreground">{formatDate(u.publishedAt || u.createdAt)}</p>{u.imageUrl && <img src={u.imageUrl} alt="" className="mt-10 max-h-[420px] w-full rounded-2xl object-cover" data-testid="img-public-update" />}<div className="prose prose-stone mt-10 max-w-none whitespace-pre-wrap text-[17px] leading-relaxed" data-testid="text-public-update-content">{u.content}</div>{u.linkUrl && <a href={u.linkUrl} target="_blank" rel="noreferrer" className="btn-primary mt-8 inline-flex" data-testid="link-public-update-cta"><Link2 size={15} /> Learn more</a>}<div className="mt-20 border-t border-border pt-5 text-xs text-muted-foreground">Nutterx Connect · Reliable services for Kenya</div></main></div>; }

function Landing() { const { isSignedIn } = useAuth(); if (new URLSearchParams(window.location.search).get('admin') === 'true') return <AdminLogin />; if (isSignedIn) return <RoleHome />; return <div className="min-h-[100dvh] overflow-hidden bg-background"><header className="flex h-[76px] items-center justify-between px-5 sm:px-10"><Brand /><div className="flex items-center gap-3"><Link href="/sign-in" className="btn-quiet" data-testid="link-sign-in">Sign in</Link><Link href="/sign-up" className="btn-primary" data-testid="link-sign-up">Create account <ArrowRight size={15} /></Link></div></header><main><section className="relative mx-auto grid max-w-[1440px] items-center gap-12 px-5 pb-20 pt-14 sm:px-10 sm:pt-24 lg:grid-cols-[1.05fr_.95fr] lg:pb-32"><div className="relative z-10 rise-in"><div className="mb-6 flex items-center gap-3 text-[11px] font-bold uppercase tracking-[.2em] text-primary"><span className="orange-rule" /> Built for staying connected</div><h1 className="display max-w-3xl text-5xl font-bold leading-[.88] tracking-[-.1em] sm:text-7xl lg:text-[7.2rem]">Your service.<br /><span className="text-primary">In focus.</span></h1><p className="mt-7 max-w-lg text-lg leading-relaxed text-muted-foreground">Nutterx Connect gives our clients a clear view of their services, expiry dates, and the updates that matter.</p><div className="mt-8 flex flex-wrap gap-3"><Link href="/sign-in" className="btn-primary px-6 py-3.5" data-testid="link-hero-sign-in">Open client portal <ArrowRight size={16} /></Link><a href="#how-it-works" className="btn-secondary px-6 py-3.5" data-testid="link-how-it-works">How it works</a></div><div className="mt-10 flex items-center gap-5 text-xs text-muted-foreground"><span className="flex items-center gap-2"><ShieldCheck size={15} className="text-primary" />Secure by design</span><span className="flex items-center gap-2"><Globe2 size={15} className="text-primary" />Kenya-based support</span></div></div><div className="relative min-h-[390px] rise-in delay-2"><div className="absolute right-0 top-1/2 size-[310px] -translate-y-1/2 rounded-full bg-primary lg:size-[430px]" /><div className="absolute left-8 top-8 z-10 w-[min(360px,88%)] rotate-[-5deg] rounded-2xl bg-sidebar p-5 text-white shadow-2xl sm:left-16 sm:top-12"><div className="flex items-center justify-between"><span className="display text-xs font-bold uppercase tracking-widest">Service posture</span><span className="grid size-7 place-items-center rounded-full bg-emerald-500"><Check size={15} /></span></div><p className="display mt-14 text-4xl font-bold">All good.</p><p className="mt-2 text-sm text-white/55">Your coverage is active and up to date.</p><div className="mt-8 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full w-[82%] rounded-full bg-primary" /></div><div className="mt-2 flex justify-between text-[10px] text-white/45"><span>Coverage window</span><span>82%</span></div></div><div className="absolute bottom-8 right-3 z-20 w-56 rotate-[6deg] rounded-2xl border border-border bg-white p-4 shadow-xl sm:right-8"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground"><Clock3 size={14} className="text-primary" /> Next expiry</div><p className="display mt-5 text-3xl font-bold">18 <span className="font-sans text-sm tracking-normal text-muted-foreground">days</span></p><p className="mt-1 text-xs font-medium">Home Connect · 4G</p></div></div></section><section id="how-it-works" className="border-y border-border bg-secondary/55"><div className="mx-auto grid max-w-[1440px] gap-0 px-5 sm:px-10 md:grid-cols-3"><Feature number="01" icon={Activity} title="See the signal" copy="One glance tells you what is active, what is close to expiry, and what needs a conversation." /><Feature number="02" icon={Bell} title="Stay in the loop" copy="Important service announcements arrive in the same place, without the noise." /><Feature number="03" icon={LifeBuoy} title="Get human help" copy="Your account context is ready for the Nutterx team when you need a hand." /></div></section><section className="mx-auto max-w-[1440px] px-5 py-20 sm:px-10 sm:py-28"><div className="grid gap-10 lg:grid-cols-[.7fr_1.3fr]"><div><p className="eyebrow">For the people behind the network</p><h2 className="display mt-3 max-w-md text-4xl font-bold leading-none tracking-[-.08em] sm:text-5xl">The cockpit for better follow-through.</h2></div><div className="grid gap-5 sm:grid-cols-2"><div className="surface rounded-2xl p-6"><Command size={22} className="text-primary" /><h3 className="mt-8 display text-xl font-bold">Tight operations</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Admins can find a client, trace a service, and act on expiry windows in fewer steps.</p></div><div className="rounded-2xl bg-primary p-6 text-white"><Sparkles size={22} /><h3 className="mt-8 display text-xl font-bold">A warmer portal</h3><p className="mt-2 text-sm leading-relaxed text-white/75">Clear language and calm surfaces make account management feel less like paperwork.</p></div></div></div></section></main><footer className="border-t border-border px-5 py-8 sm:px-10"><div className="mx-auto flex max-w-[1440px] flex-col justify-between gap-3 text-xs text-muted-foreground sm:flex-row"><span className="display font-bold uppercase tracking-[-.03em] text-foreground">Nutterx Connect</span><span>Reliable service, close to home.</span></div></footer></div>; }

function PublicLanding() {
  const adminMode = new URLSearchParams(window.location.search).get('admin') === 'true';
  const clientsQuery = useQuery<{ name: string }[]>({
    queryKey: ['public-active-clients'],
    enabled: !adminMode,
    queryFn: async () => {
      const response = await fetch('/api/public/clients');
      if (!response.ok) throw new Error('Unable to load active clients');
      return response.json() as Promise<{ name: string }[]>;
    },
    staleTime: 30_000,
  });
  if (adminMode) return <AdminLogin />;
  return <div className="min-h-[100dvh] overflow-hidden bg-background">
    <header className="flex h-[76px] items-center justify-between px-5 sm:px-10">
      <Brand />
      <a href="#active-clients" className="btn-secondary" data-testid="link-active-clients">Active clients <ArrowRight size={15} /></a>
    </header>
    <main>
      <section className="relative mx-auto grid max-w-[1440px] items-center gap-12 px-5 pb-20 pt-14 sm:px-10 sm:pt-24 lg:grid-cols-[1.05fr_.95fr] lg:pb-28">
        <div className="relative z-10 rise-in">
          <div className="mb-6 flex items-center gap-3 text-[11px] font-bold uppercase tracking-[.2em] text-primary"><span className="orange-rule" /> Nutterx Connect</div>
          <h1 className="display max-w-3xl text-5xl font-bold leading-[.88] tracking-[-.1em] sm:text-7xl lg:text-[7.2rem]">Connected.<br /><span className="text-primary">And in focus.</span></h1>
          <p className="mt-7 max-w-lg text-lg leading-relaxed text-muted-foreground">A clear view of the active clients in our service network, managed by the Nutterx Connect team.</p>
          <a href="#active-clients" className="btn-primary mt-8 px-6 py-3.5">View active clients <ArrowRight size={16} /></a>
        </div>
        <div className="relative min-h-[300px] rise-in delay-2">
          <div className="absolute right-0 top-1/2 size-[260px] -translate-y-1/2 rounded-full bg-primary sm:size-[340px]" />
          <div className="absolute left-4 top-1/2 z-10 w-[min(360px,90%)] -translate-y-1/2 rotate-[-4deg] rounded-2xl bg-sidebar p-6 text-white shadow-2xl sm:left-12">
            <p className="eyebrow text-primary">Service network</p><p className="display mt-8 text-4xl font-bold">Nutterx<br />Connect</p><p className="mt-3 text-sm text-white/60">Client relationships, managed with care.</p>
          </div>
        </div>
      </section>
      <section id="active-clients" className="border-y border-border bg-secondary/45 px-5 py-16 sm:px-10 sm:py-20">
        <div className="mx-auto max-w-[1200px]">
          <div className="mb-8 flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="eyebrow">Client directory</p><h2 className="display mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Active clients</h2></div>{clientsQuery.data && <span className="mono text-sm text-muted-foreground">{clientsQuery.data.length} active</span>}</div>
          {clientsQuery.isLoading ? <PageLoader label="Loading active clients" /> : clientsQuery.isError ? <ErrorState onRetry={() => clientsQuery.refetch()} /> : clientsQuery.data?.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{clientsQuery.data.map((client, index) => <div key={`${client.name}-${index}`} className="surface flex items-center gap-3 rounded-xl p-4" data-testid={`public-active-client-${index}`}><span className="grid size-10 place-items-center rounded-full bg-accent text-sm font-bold text-primary">{initials(client.name)}</span><span className="font-semibold">{client.name}</span><span className="ml-auto size-2 rounded-full bg-emerald-500" aria-label="Active" /></div>)}</div> : <EmptyState icon={Users} title="No active clients to show" copy="The public client directory will update as active clients are added." />}
        </div>
      </section>
    </main>
    <footer className="border-t border-border px-5 py-7 sm:px-10"><div className="mx-auto flex max-w-[1440px] flex-col justify-between gap-3 text-xs text-muted-foreground sm:flex-row"><span className="display font-bold uppercase tracking-[-.03em] text-foreground">Nutterx Connect</span><span>Reliable service, close to home.</span></div></footer>
  </div>;
}

function Feature({ number, icon: Icon, title, copy }: { number: string; icon: IconType; title: string; copy: string }) { return <div className="border-b border-border px-0 py-8 md:border-b-0 md:border-r md:px-8 md:py-12 first:md:pl-0 last:md:border-r-0"><div className="flex items-center justify-between"><span className="mono text-xs text-primary">{number}</span><Icon size={18} className="text-primary" /></div><h3 className="display mt-8 text-xl font-bold">{title}</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{copy}</p></div>; }

function AdminLogin() {
  const [, setLocation] = useLocation();
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ key }),
      });
      if (!response.ok) {
        setError('The administrator credentials were not accepted.');
        return;
      }
      setLocation('/admin');
    } catch {
      setError('Unable to connect to the portal. Try again.');
    } finally {
      setPending(false);
    }
  };
  return <div className="auth-page min-h-[100dvh] bg-background px-5">
    <div className="surface w-full max-w-md rounded-2xl p-7 sm:p-9">
      <Brand />
      <div className="mt-10"><p className="eyebrow">Restricted access</p><h1 className="display mt-2 text-3xl font-bold">Administrator login</h1><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Sign in to manage clients, services, and announcements.</p></div>
      <form onSubmit={submit} className="mt-7 grid gap-4">
        <Field label="Admin key" value={key} onChange={setKey} type="password" autoComplete="current-password" required />
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
        <button disabled={pending} className="btn-primary mt-2 justify-center" data-testid="button-admin-login">{pending ? 'Signing in…' : 'Sign in to admin'}</button>
      </form>
      <Link href="/" className="mt-6 block text-center text-xs font-semibold text-muted-foreground hover:text-primary">Return to client portal</Link>
    </div>
  </div>;
}
function RoleHome() { const query = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey() } }); if (query.isLoading) return <PageLoader />; if (query.isError || !query.data) return <ErrorState onRetry={() => query.refetch()} />; return <Redirect to={query.data.role === 'admin' ? '/admin' : '/client'} />; }
function AdminRoute({ children }: { children: ReactNode }) {
  const query = useQuery<CurrentUser>({
    queryKey: ['admin-session'],
    queryFn: async () => {
      const response = await fetch('/api/admin/session', { credentials: 'include' });
      if (!response.ok) throw new Error('Administrator login required');
      return response.json() as Promise<CurrentUser>;
    },
    retry: false,
  });
  if (query.isLoading) return <PageLoader label="Checking administrator session" />;
  if (query.isError || !query.data) return <Redirect to="/?admin=true" />;
  return <PortalShell user={query.data}>{children}</PortalShell>;
}
function ClientRoute({ children }: { children: ReactNode }) { const query = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey() } }); if (query.isLoading) return <PageLoader />; if (!query.data || query.data.role !== 'client') return <Redirect to="/admin" />; return <PortalShell user={query.data}>{children}</PortalShell>; }

function AuthRoutes() {
  return <Switch>
    <Route path="/"><PublicLanding /></Route>
    <Route path="/admin"><AdminRoute><AdminHome /></AdminRoute></Route>
    <Route path="/admin/clients"><AdminRoute><AdminClients /></AdminRoute></Route>
    <Route path="/admin/clients/:id"><AdminRoute><AdminClientDetail /></AdminRoute></Route>
    <Route path="/admin/services"><AdminRoute><AdminServices /></AdminRoute></Route>
    <Route path="/admin/service-types"><AdminRoute><AdminServiceTypes /></AdminRoute></Route>
    <Route path="/admin/updates"><AdminRoute><AdminUpdates /></AdminRoute></Route>
    <Route path="/admin/updates/new"><AdminRoute><UpdateEditor /></AdminRoute></Route>
    <Route path="/updates/:slug"><PublicUpdate /></Route>
    <Route component={NotFound} />
  </Switch>;
}

function App() { return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={basePath}><ErrorBoundary resetKey={window.location.pathname}><AuthRoutes /></ErrorBoundary></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>; }

function formatDate(value: string) { if (!value) return '—'; return new Intl.DateTimeFormat('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value)); }
function initials(name: string) { return name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase(); }

export default App;