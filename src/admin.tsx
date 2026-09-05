import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Boxes,
  Check,
  ChevronRight,
  ClipboardList,
  FileText,
  LayoutDashboard,
  ListFilter,
  LogOut,
  Menu,
  MessageSquare,
  Package,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Tags,
  Truck,
  Users,
  X,
  Eye,
  Pencil,
  Upload,
  Clock,
  CircleDollarSign,
  AlertTriangle,
  Leaf,
} from 'lucide-react';
import { api, mutate, money, dateLabel, today, type RecordData, type User } from './api.js';
import { Badge, Empty, ErrorMessage, Loading, Logo, Modal } from './ui.js';
import { Notifications, type LiveEvent } from './notifications.js';

type Field = {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
  options?: any[];
  min?: number;
  max?: number;
  help?: string;
};
const config: Record<
  string,
  {
    title: string;
    singular: string;
    description: string;
    icon: any;
    roles: string[];
    fields?: Field[];
  }
> = {
  overview: {
    title: 'Overview',
    singular: 'Overview',
    description: 'A clear view of your wholesale business.',
    icon: LayoutDashboard,
    roles: ['Owner', 'Sales'],
  },
  products: {
    title: 'Products',
    singular: 'Product',
    description: 'Your catalogue, ready for every kitchen.',
    icon: Package,
    roles: ['Owner', 'Sales', 'Warehouse'],
    fields: [
      { key: 'name', label: 'Product name', required: true },
      { key: 'brand', label: 'Brand', type: 'select', required: true },
      { key: 'category', label: 'Category', type: 'select', required: true },
      { key: 'packSize', label: 'Pack size', required: true },
      { key: 'moq', label: 'Minimum order label', required: true },
      {
        key: 'minQuantity',
        label: 'Minimum packs per order',
        type: 'number',
        min: 1,
        required: true,
      },
      {
        key: 'image',
        label: 'Product image URL',
        help: 'Upload a JPEG, PNG, or WebP below, or enter an HTTPS image URL.',
      },
      { key: 'description', label: 'Description', type: 'textarea' },
      {
        key: 'hsn',
        label: 'HSN code',
        help: 'Required before invoicing. Enter the verified 4, 6, or 8 digit code.',
      },
      { key: 'lowStockThreshold', label: 'Low-stock threshold (packs)', type: 'number', min: 0 },
      {
        key: 'availability',
        label: 'Catalogue availability',
        type: 'select',
        options: ['On request', 'Available', 'Unavailable'],
      },
      { key: 'published', label: 'Published in customer catalogue', type: 'checkbox' },
      { key: 'featured', label: 'Kitchen favourite', type: 'checkbox' },
    ],
  },
  enquiries: {
    title: 'Enquiries',
    singular: 'Enquiry',
    description: 'Turn the next conversation into a lasting partnership.',
    icon: MessageSquare,
    roles: ['Owner', 'Sales'],
  },
  customers: {
    title: 'Customers',
    singular: 'Customer',
    description: 'The people and kitchens you supply.',
    icon: Users,
    roles: ['Owner', 'Sales'],
    fields: [
      { key: 'name', label: 'Contact name', required: true },
      { key: 'business', label: 'Business name', required: true },
      { key: 'phone', label: 'Phone', required: true },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'address', label: 'Billing / delivery address', type: 'textarea' },
      { key: 'gstin', label: 'GSTIN (leave empty for unregistered)' },
      {
        key: 'stateCode',
        label: 'Place-of-supply state code',
        help: 'Two digits, e.g. 07 for Delhi. Confirm with the customer.',
      },
      { key: 'notes', label: 'Internal notes', type: 'textarea' },
    ],
  },
  quotes: {
    title: 'Quotations',
    singular: 'Quotation',
    description: 'Customer-specific rates, clearly documented.',
    icon: FileText,
    roles: ['Owner', 'Sales'],
  },
  orders: {
    title: 'Orders',
    singular: 'Order',
    description: 'From confirmation to the customer’s kitchen.',
    icon: ShoppingBag,
    roles: ['Owner', 'Sales', 'Warehouse'],
  },
  batches: {
    title: 'Inventory',
    singular: 'Stock receipt',
    description: 'One warehouse. Every batch accounted for.',
    icon: Boxes,
    roles: ['Owner', 'Warehouse'],
    fields: [
      { key: 'productId', label: 'Product', type: 'select', required: true },
      { key: 'batch', label: 'Batch number', required: true },
      { key: 'expiry', label: 'Expiry date', type: 'date', required: true },
      { key: 'quantity', label: 'Packs received', type: 'number', min: 1, required: true },
      { key: 'reason', label: 'Supplier / receipt reference', required: true },
    ],
  },
  invoices: {
    title: 'Invoices',
    singular: 'Invoice',
    description: 'Issued documents and a reliable payment trail.',
    icon: ClipboardList,
    roles: ['Owner', 'Sales'],
  },
  brands: {
    title: 'Brands',
    singular: 'Brand',
    description: 'Trusted names in your catalogue.',
    icon: Tags,
    roles: ['Owner'],
    fields: [
      { key: 'name', label: 'Brand name', required: true },
      { key: 'active', label: 'Visible in brand filters', type: 'checkbox' },
    ],
  },
  categories: {
    title: 'Categories',
    singular: 'Category',
    description: 'Keep your product range easy to browse.',
    icon: ListFilter,
    roles: ['Owner'],
    fields: [
      { key: 'name', label: 'Category name', required: true },
      { key: 'active', label: 'Visible in category filters', type: 'checkbox' },
    ],
  },
  staff: {
    title: 'Staff & access',
    singular: 'Staff member',
    description: 'The right access for each member of your team.',
    icon: ShieldCheck,
    roles: ['Owner'],
    fields: [
      { key: 'name', label: 'Full name', required: true },
      { key: 'email', label: 'Email address', type: 'email', required: true },
      { key: 'role', label: 'Role', type: 'select', options: ['Sales', 'Warehouse', 'Owner'] },
      {
        key: 'password',
        label: 'Password',
        type: 'password',
        help: 'At least 12 characters. Leave empty when editing to keep the current password.',
      },
      { key: 'active', label: 'Active account', type: 'checkbox' },
    ],
  },
  settings: {
    title: 'Business settings',
    singular: 'Settings',
    description: 'Your public identity and invoicing essentials.',
    icon: Settings,
    roles: ['Owner'],
    fields: [
      { key: 'businessName', label: 'Business / legal name', required: true },
      { key: 'phone', label: 'Public phone (10 digits)', required: true },
      { key: 'instagram', label: 'Instagram URL', required: true },
      { key: 'email', label: 'Business email', type: 'email' },
      { key: 'heroTitle', label: 'Homepage headline', required: true },
      { key: 'heroDescription', label: 'Homepage introduction', type: 'textarea', required: true },
      { key: 'address', label: 'Registered business address', type: 'textarea' },
      { key: 'gstin', label: 'Business GSTIN' },
      { key: 'stateCode', label: 'Registered state code' },
      { key: 'warehouseName', label: 'Warehouse name', required: true },
      { key: 'invoiceTerms', label: 'Quotation / invoice terms', type: 'textarea' },
      { key: 'bankDetails', label: 'Bank details for invoice', type: 'textarea' },
    ],
  },
  audit: {
    title: 'Activity log',
    singular: 'Activity',
    description: 'A history of important changes and the people behind them.',
    icon: Clock,
    roles: ['Owner'],
  },
};

export function Admin() {
  const [user, setUser] = useState<User | null>(null),
    [checking, setChecking] = useState(true),
    [authNotice, setAuthNotice] = useState('');
  useEffect(() => {
    api('/api/admin/me')
      .then(setUser)
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);
  if (checking)
    return (
      <div className="auth-page">
        <Loading />
      </div>
    );
  if (!user)
    return (
      <Login
        notice={authNotice}
        onLogin={(u) => {
          setUser(u);
          history.replaceState({}, '', '/admin');
        }}
      />
    );
  return (
    <Workspace
      user={user}
      onUser={(next) =>
        setUser((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next))
      }
      onExpired={() => {
        setAuthNotice(
          'Your session expired or account access changed. Please sign in to continue.',
        );
        setUser(null);
      }}
      onLogout={() => {
        setUser(null);
        history.replaceState({}, '', '/admin/login');
      }}
    />
  );
}
function Login({ onLogin, notice = '' }: { onLogin: (u: User) => void; notice?: string }) {
  const [mode, setMode] = useState(location.pathname === '/admin/reset' ? 'reset' : 'login'),
    [error, setError] = useState(''),
    [message, setMessage] = useState(notice),
    [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const f = new FormData(e.currentTarget);
    try {
      if (mode === 'login')
        onLogin(
          await api('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: f.get('email'), password: f.get('password') }),
          }),
        );
      else if (mode === 'forgot') {
        const r = await api('/api/auth/forgot', {
          method: 'POST',
          body: JSON.stringify({ email: f.get('email') }),
        });
        setMessage(r.message);
      } else {
        await api('/api/auth/reset', {
          method: 'POST',
          body: JSON.stringify({ token: location.hash.slice(1), password: f.get('password') }),
        });
        history.replaceState({}, '', '/admin/login');
        setMode('login');
        setMessage('Password updated. Sign in with your new password.');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="auth-page">
      <a href="/" className="auth-back">
        <ArrowLeft size={17} /> Back to website
      </a>
      <div className="auth-brand-panel">
        <Logo light />
        <div>
          <p className="eyebrow">BUILT FOR YOUR EVERYDAY</p>
          <h1>
            Good business.
            <br />
            Great partnerships.
          </h1>
          <p>
            Your catalogue, customers, and operations.
            <br />
            All in one place.
          </p>
        </div>
        <span>HORECA YARD · ADMIN PORTAL</span>
      </div>
      <div className="auth-form-panel">
        <div className="auth-card">
          <div className="auth-icon">
            <Leaf size={30} />
          </div>
          <p className="eyebrow">HORECA YARD</p>
          <h2>
            {mode === 'login'
              ? 'Welcome back.'
              : mode === 'forgot'
                ? 'Forgot your password?'
                : 'Set a new password.'}
          </h2>
          <p>
            {mode === 'login'
              ? 'Sign in to your wholesale workspace.'
              : mode === 'forgot'
                ? 'We’ll email you a secure reset link.'
                : 'Choose at least 12 characters.'}
          </p>
          <form onSubmit={submit}>
            {mode !== 'reset' && (
              <label>
                Email address
                <input
                  name="email"
                  type="email"
                  placeholder="you@horecayard.com"
                  autoComplete="username"
                  required
                />
              </label>
            )}
            {mode !== 'forgot' && (
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  minLength={mode === 'reset' ? 12 : 1}
                  maxLength={200}
                  autoComplete={mode === 'reset' ? 'new-password' : 'current-password'}
                  required
                />
              </label>
            )}
            <ErrorMessage error={error} />
            {message && (
              <p className="success-message" role="status">
                {message}
              </p>
            )}
            <button className="button green full" disabled={busy}>
              {busy
                ? 'Please wait…'
                : mode === 'login'
                  ? 'Sign in'
                  : mode === 'forgot'
                    ? 'Send reset link'
                    : 'Update password'}
              <ArrowRight size={17} />
            </button>
          </form>
          <button
            className="text-button"
            onClick={() => {
              setMode(mode === 'login' ? 'forgot' : 'login');
              setError('');
              setMessage('');
            }}
          >
            {mode === 'login' ? 'Forgot password?' : 'Back to sign in'}
          </button>
          <small className="auth-foot">
            <ShieldCheck size={14} /> Secure access for authorised staff
          </small>
        </div>
      </div>
    </main>
  );
}

function Workspace({
  user,
  onLogout,
  onUser,
  onExpired,
}: {
  user: User;
  onLogout: () => void;
  onUser: (user: User) => void;
  onExpired: () => void;
}) {
  const initial = location.pathname.split('/')[2];
  const defaultModule = user.role === 'Warehouse' ? 'batches' : 'overview';
  const [module, setModule] = useState(
      config[initial]?.roles.includes(user.role) ? initial : defaultModule,
    ),
    [rows, setRows] = useState<RecordData[]>([]),
    [related, setRelated] = useState<Record<string, RecordData[]>>({}),
    [report, setReport] = useState<any>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [toast, setToast] = useState(''),
    [search, setSearch] = useState(''),
    [status, setStatus] = useState('All'),
    [modal, setModal] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [mobile, setMobile] = useState(false),
    [refresh, setRefresh] = useState(0),
    [draftNotice, setDraftNotice] = useState(''),
    [sectionUnread, setSectionUnread] = useState<Record<string, number>>({});
  const loadedModule = useRef<string | null>(null);
  const owner = user.role === 'Owner',
    sales = user.role !== 'Warehouse',
    operations = user.role !== 'Sales';
  const conf = config[module];
  const navigate = (name: string) => {
    setModule(name);
    setSearch('');
    setStatus('All');
    setError('');
    setMobile(false);
    history.pushState({}, '', `/admin/${name === 'overview' ? '' : name}`);
  };
  useEffect(() => {
    if (!config[module].roles.includes(user.role)) navigate(defaultModule);
  }, [user.role]);
  useEffect(() => {
    const pop = () => {
      const n = location.pathname.split('/')[2];
      setModule(config[n]?.roles.includes(user.role) ? n : defaultModule);
    };
    addEventListener('popstate', pop);
    return () => removeEventListener('popstate', pop);
  }, [user.role]);
  useEffect(() => {
    let live = true;
    if (loadedModule.current !== module) {
      setLoading(true);
      setError('');
    }
    const load = async () => {
      const names = [
        'workspace',
        'products',
        'brands',
        'categories',
        ...(sales ? ['customers', 'enquiries', 'orders'] : []),
      ];
      const [r, rels] = await Promise.all([
        module === 'overview' ? api('/api/admin/reports') : api(`/api/admin/${module}`),
        Promise.all(names.map(async (n) => [n, await api(`/api/admin/${n}`)])),
      ]);
      if (live) {
        if (module === 'overview') setReport(r);
        else setRows(r);
        setRelated(Object.fromEntries(rels));
        loadedModule.current = module;
      }
    };
    load()
      .catch((e) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [module, refresh, user.role]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(''), 5000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const execute = async (
    action: () => Promise<any>,
    success = 'Saved successfully',
    close = true,
  ) => {
    setBusy(true);
    setError('');
    try {
      const result = await action();
      setToast(success);
      setRefresh((r) => r + 1);
      if (close) setModal(null);
      return result;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  const open = (value: any) => {
    setError('');
    setDraftNotice('');
    setModal(value);
  };
  const editable = ['products', 'brands', 'categories', 'settings', 'staff'].includes(module)
    ? owner
    : module === 'customers'
      ? sales
      : module === 'batches'
        ? operations
        : false;
  const rowTitle = (r: RecordData) => r.reference || r.name || r.batch || r.business || r.action;
  const filtered = rows.filter(
    (r) =>
      JSON.stringify(r).toLowerCase().includes(search.toLowerCase()) &&
      (status === 'All' || r.status === status),
  );
  const statuses = Array.from(new Set(rows.map((r) => r.status).filter(Boolean)));
  const productName = (id: string) => related.products?.find((p) => p.id === id)?.name || id;
  const newRecord = () =>
    open(
      module === 'quotes'
        ? { type: 'quote', row: null }
        : { type: 'edit', kind: module, row: null },
    );
  const saveGeneric = (kind: string, d: any, row?: RecordData) =>
    execute(() =>
      mutate(
        `/api/admin/${kind}${row && kind !== 'staff' ? '/' + row.id : ''}`,
        kind === 'staff' && row ? { ...d, id: row.id } : d,
        row && kind !== 'staff' ? 'PUT' : 'POST',
      ),
    );
  const tableColumns = () => {
    if (module === 'products')
      return ['Product', 'Category', 'Pack / minimum', 'Availability', 'Published'];
    if (module === 'enquiries')
      return ['Enquiry', 'Business / contact', 'Status', 'Follow-up', 'Received'];
    if (module === 'customers') return ['Business', 'Contact', 'Phone', 'GSTIN', 'State'];
    if (module === 'quotes') return ['Quotation', 'Customer', 'Status', 'Valid until', 'Total'];
    if (module === 'orders')
      return [
        'Order',
        'Customer',
        'Status',
        'Created',
        sales ? 'Total / paid' : 'Delivery reference',
      ];
    if (module === 'batches')
      return ['Product / batch', 'Expiry', 'On hand', 'Reserved', 'Available'];
    if (module === 'invoices') return ['Invoice', 'Customer', 'Issued', 'Tax', 'Total'];
    if (module === 'staff') return ['Name', 'Email', 'Role', 'Status'];
    if (module === 'audit') return ['Action', 'Actor', 'Area', 'Record', 'Date'];
    return ['Name', 'Status'];
  };
  const cells = (r: RecordData): React.ReactNode[] => {
    if (module === 'products')
      return [
        <div className="table-product">
          <img src={r.image || '/images/hero-cluster.jpg'} alt="" />
          <div>
            <b>{r.name}</b>
            <small>{r.brand}</small>
          </div>
        </div>,
        r.category,
        <>
          <b>{r.packSize}</b>
          <small>{r.moq}</small>
        </>,
        <Badge>{r.availability}</Badge>,
        <Badge>{r.published ? 'Published' : 'Draft'}</Badge>,
      ];
    if (module === 'enquiries')
      return [
        <b>{r.reference}</b>,
        <>
          <b>{r.business || r.name}</b>
          <small>
            {r.name} · {r.phone}
          </small>
        </>,
        <Badge>{r.status}</Badge>,
        dateLabel(r.followUp),
        dateLabel(r.createdAt),
      ];
    if (module === 'customers')
      return [
        <b>{r.business}</b>,
        r.name,
        r.phone,
        r.gstin || 'Unregistered',
        r.stateCode || 'Not set',
      ];
    if (module === 'quotes')
      return [
        <b>{r.reference}</b>,
        r.customer?.business,
        <Badge>{r.status}</Badge>,
        dateLabel(r.validUntil),
        <b>{money(r.total)}</b>,
      ];
    if (module === 'orders')
      return [
        <b>{r.reference}</b>,
        r.customer?.business,
        <Badge>{r.status}</Badge>,
        dateLabel(r.createdAt),
        sales ? (
          <>
            <b>{money(r.total)}</b>
            <small>{money(r.paid)} paid</small>
          </>
        ) : (
          r.deliveryReference || '—'
        ),
      ];
    if (module === 'batches')
      return [
        <>
          <b>{productName(r.productId)}</b>
          <small>{r.batch}</small>
        </>,
        <span className={r.expiry < today() ? 'danger-text' : ''}>
          {dateLabel(r.expiry)}
          {r.expiry < today() ? ' · Expired' : ''}
        </span>,
        r.quantity,
        r.reserved,
        r.expiry < today() ? 0 : r.quantity - r.reserved,
      ];
    if (module === 'invoices')
      return [
        <b>{r.reference}</b>,
        r.customer?.business,
        dateLabel(r.issuedAt),
        r.taxType,
        <b>{money(r.total)}</b>,
      ];
    if (module === 'staff')
      return [<b>{r.name}</b>, r.email, <Badge>{r.role}</Badge>, r.active ? 'Active' : 'Inactive'];
    if (module === 'audit')
      return [
        r.action,
        r.actor,
        r.entity,
        <span className="record-id">{r.recordId}</span>,
        dateLabel(r.at),
      ];
    return [<b>{r.name}</b>, r.active ? 'Active' : 'Hidden'];
  };
  return (
    <div className="admin-shell">
      <aside className={`admin-sidebar ${mobile ? 'mobile-open' : ''}`}>
        <div className="sidebar-brand">
          <Logo light />
          <button
            className="icon-button mobile-menu"
            onClick={() => setMobile(false)}
            aria-label="Close menu"
          >
            <X />
          </button>
        </div>
        <p className="sidebar-label">YOUR WORKSPACE</p>
        <nav aria-label="Admin navigation">
          {Object.entries(config)
            .filter(([, c]) => c.roles.includes(user.role))
            .map(([key, c]) => (
              <button
                key={key}
                className={module === key ? 'active' : ''}
                onClick={() => navigate(key)}
              >
                <c.icon size={18} />
                {c.title}
                {!!sectionUnread[key] && (
                  <strong
                    className="section-unread"
                    aria-label={`${sectionUnread[key]} unread updates`}
                    title={`${sectionUnread[key]} unread updates. Mark all read in Notifications to clear.`}
                  >
                    {sectionUnread[key] > 99 ? '99+' : sectionUnread[key]}
                  </strong>
                )}
                {module === key && !sectionUnread[key] && <span />}
              </button>
            ))}
        </nav>
        <a className="view-site" href="/" target="_blank" rel="noreferrer">
          View public website <ArrowUpRight size={17} />
        </a>
        <div className="sidebar-user">
          <span className="avatar">{user.name.slice(0, 1)}</span>
          <div>
            <b>{user.name}</b>
            <small>{user.role}</small>
          </div>
          <button
            aria-label="Sign out"
            onClick={() => void api('/api/auth/logout', { method: 'POST' }).then(onLogout)}
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-topbar">
          <div>
            <button
              className="icon-button mobile-menu"
              aria-label="Open menu"
              onClick={() => setMobile(true)}
            >
              <Menu />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <b>{conf.title}</b>
          </div>
          <div>
            <span className="workspace-dot" />{' '}
            {related.workspace?.[0]?.warehouseName || 'Main warehouse'}{' '}
            <span className="topbar-date">{dateLabel(today())}</span>
          </div>
          <Notifications
            user={user}
            onSections={setSectionUnread}
            onUser={onUser}
            onExpired={onExpired}
            onNavigate={(name) => {
              if (config[name]?.roles.includes(user.role)) {
                setModal(null);
                navigate(name);
              }
            }}
            onUpdate={(events: LiveEvent[]) => {
              setRefresh((n) => n + 1);
              if (
                modal?.row &&
                events.some((e) => e.recordId === modal.row.id && e.actorId !== user.id)
              )
                setDraftNotice(
                  'This record changed elsewhere. Your open form has been preserved; close and reopen it to load the latest version.',
                );
            }}
          />
        </header>
        <main className="admin-content">
          <div className="admin-title">
            <div>
              <p className="eyebrow">
                HORECA YARD / {module === 'overview' ? 'AT A GLANCE' : 'OPERATIONS'}
              </p>
              <h1>
                {conf.title}
                <span>.</span>
              </h1>
              <p>{conf.description}</p>
            </div>
            <div className="admin-title-actions">
              {!['overview', 'staff', 'settings'].includes(module) && (
                <a className="button outline small" href={`/api/admin/${module}/export`}>
                  <ArrowDownToLine size={16} /> Export CSV
                </a>
              )}
              {((editable && module !== 'settings') || module === 'quotes') && (
                <button className="button green small" onClick={newRecord}>
                  <Plus size={17} />
                  {module === 'batches' ? 'Receive stock' : `Add ${conf.singular.toLowerCase()}`}
                </button>
              )}
            </div>
          </div>
          {toast && (
            <div className="toast" role="status">
              <Check size={17} />
              {toast}
            </div>
          )}
          {!modal && <ErrorMessage error={error} />}
          {loading ? (
            <Loading />
          ) : module === 'overview' ? (
            <Overview report={report} onNavigate={navigate} />
          ) : module === 'settings' ? (
            <div className="settings-panel">
              <div className="settings-notice">
                <ShieldCheck size={22} />
                <div>
                  <b>Ready for business, configured by you.</b>
                  <p>
                    Complete the registered address, GSTIN and state before issuing invoices. Public
                    contact and homepage changes appear immediately.
                  </p>
                </div>
              </div>
              {rows[0] && (
                <Editor
                  kind="settings"
                  row={rows[0]}
                  related={related}
                  busy={busy}
                  onSave={(d) => saveGeneric('settings', d, rows[0])}
                />
              )}
            </div>
          ) : (
            <>
              <div className="admin-table-tools">
                <div className="search-field">
                  <Search size={17} />
                  <input
                    aria-label={`Search ${conf.title}`}
                    placeholder={`Search ${conf.title.toLowerCase()}…`}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div>
                  {statuses.length > 0 && (
                    <select
                      aria-label="Filter status"
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                    >
                      <option value="All">All statuses</option>
                      {statuses.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  )}
                  <span>{filtered.length} records</span>
                </div>
              </div>
              {filtered.length ? (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        {tableColumns().map((c) => (
                          <th key={c}>{c}</th>
                        ))}
                        {module !== 'audit' && (
                          <th>
                            <span className="sr-only">Actions</span>
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r) => (
                        <tr key={r.id}>
                          {cells(r).map((c, i) => (
                            <td key={i}>{c}</td>
                          ))}
                          {module !== 'audit' && (
                            <td className="row-actions">
                              {module === 'invoices' ? (
                                <a
                                  className="icon-button"
                                  href={`/api/admin/invoices/${r.id}/pdf`}
                                  aria-label={`Download ${r.reference}`}
                                >
                                  <ArrowDownToLine size={17} />
                                </a>
                              ) : (
                                <button
                                  className="icon-button"
                                  aria-label={`Open ${rowTitle(r)}`}
                                  onClick={() =>
                                    open(
                                      editable && module !== 'batches'
                                        ? { type: 'edit', kind: module, row: r }
                                        : { type: 'detail', kind: module, row: r },
                                    )
                                  }
                                >
                                  {editable && module !== 'batches' ? (
                                    <Pencil size={16} />
                                  ) : (
                                    <Eye size={17} />
                                  )}
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty
                  title={
                    search || status !== 'All'
                      ? 'No matching records'
                      : `No ${conf.title.toLowerCase()} yet`
                  }
                >
                  {module === 'invoices'
                    ? 'Issue an invoice from a confirmed order.'
                    : module === 'orders'
                      ? 'Accept a quotation and confirm it to reserve stock and create an order.'
                      : module === 'enquiries'
                        ? 'New requests from the website will appear here.'
                        : 'Your records will appear here as you start working.'}
                </Empty>
              )}
              {module === 'batches' && (
                <button
                  className="button outline small"
                  onClick={() => open({ type: 'movements' })}
                >
                  <Clock size={16} /> View stock movement history
                </button>
              )}
            </>
          )}
        </main>
        <footer className="admin-footer">
          <span>HORECA YARD</span>
          <span>Better products. Better prices. Better business.</span>
        </footer>
      </div>
      {modal && (
        <Modal
          wide={['quote', 'detail', 'movements'].includes(modal.type)}
          title={
            modal.type === 'edit'
              ? `${modal.row ? 'Edit' : 'Add'} ${config[modal.kind].singular.toLowerCase()}`
              : modal.type === 'quote'
                ? 'Prepare quotation'
                : modal.type === 'movements'
                  ? 'Stock movement history'
                  : modal.row?.reference || modal.row?.name || 'Record details'
          }
          onClose={() => {
            if (!busy) {
              setModal(null);
              setError('');
            }
          }}
        >
          <ErrorMessage error={error} />
          {draftNotice && (
            <p className="draft-notice" role="status">
              {draftNotice}
            </p>
          )}
          {modal.type === 'edit' ? (
            <Editor
              kind={modal.kind}
              row={modal.row}
              related={related}
              busy={busy}
              onSave={(d) => saveGeneric(modal.kind, d, modal.row)}
            />
          ) : modal.type === 'quote' ? (
            <QuoteEditor
              row={modal.row}
              initial={modal.initial}
              related={related}
              busy={busy}
              onSave={(d) =>
                execute(
                  () =>
                    mutate(
                      `/api/admin/quotes${modal.row ? '/' + modal.row.id : ''}`,
                      d,
                      modal.row ? 'PUT' : 'POST',
                    ),
                  'Quotation saved',
                )
              }
            />
          ) : modal.type === 'movements' ? (
            <Movements productName={productName} />
          ) : (
            <Details
              kind={modal.kind}
              row={modal.row}
              related={related}
              busy={busy}
              user={user}
              productName={productName}
              execute={execute}
              open={open}
            />
          )}
        </Modal>
      )}
    </div>
  );
}
function Overview({ report: r, onNavigate }: { report: any; onNavigate: (s: string) => void }) {
  if (!r) return null;
  return (
    <>
      <div className="overview-welcome">
        <div>
          <span className="eyebrow">YOUR WHOLESALE DESK</span>
          <h2>
            A fresh day.
            <br />A world of opportunity.
          </h2>
          <p>Keep your kitchens supplied and your business moving.</p>
          <button onClick={() => onNavigate('enquiries')}>
            View enquiries <ArrowRight size={17} />
          </button>
        </div>
        <div className="overview-art">
          <img src="/images/hero-cluster.jpg" alt="Wholesale product selection" />
          <span>
            <ShieldCheck size={15} /> GENUINE PRODUCTS. STRONG PARTNERSHIPS.
          </span>
        </div>
      </div>
      <div className="metric-grid">
        {[
          [MessageSquare, 'New enquiries', r.newEnquiries, 'Ready for a conversation'],
          [ShoppingBag, 'Confirmed order value', money(r.orderTotal), `${r.orders} active orders`],
          [
            CircleDollarSign,
            'Outstanding invoices',
            money(r.outstanding),
            'Awaiting offline payment',
          ],
          [BarChart3, 'Enquiry conversion', `${r.conversion}%`, 'Enquiries converted to orders'],
        ].map(([Icon, label, value, sub]: any) => (
          <div className="metric" key={label}>
            <div>
              <span>{label}</span>
              <Icon size={18} />
            </div>
            <strong>{value}</strong>
            <small>{sub}</small>
          </div>
        ))}
      </div>
      <div className="overview-panels">
        <section className="panel">
          <div className="panel-heading">
            <h3>
              <Package size={18} /> Low stock
            </h3>
            <Badge>{r.lowStock.length}</Badge>
          </div>
          {r.lowStock.length ? (
            r.lowStock.slice(0, 6).map((p: any) => (
              <div className="alert-row" key={p.id}>
                <span>
                  {p.name}
                  <small>{p.packSize}</small>
                </span>
                <b>{p.stock} packs</b>
              </div>
            ))
          ) : (
            <Empty title="Stock levels look good" />
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h3>
              <Clock size={18} /> Expiring within 30 days
            </h3>
            <Badge>{r.expiring.length}</Badge>
          </div>
          {r.expiring.length ? (
            r.expiring.map((b: any) => (
              <div className="alert-row" key={b.id}>
                <span>
                  Batch {b.batch}
                  <small>{b.quantity} packs on hand</small>
                </span>
                <b className={b.expiry < today() ? 'danger-text' : ''}>{dateLabel(b.expiry)}</b>
              </div>
            ))
          ) : (
            <Empty title="No batches nearing expiry">
              Expiry alerts appear after stock is received.
            </Empty>
          )}
        </section>
      </div>
    </>
  );
}

function Editor({
  kind,
  row,
  related,
  busy,
  onSave,
}: {
  kind: string;
  row?: RecordData;
  related: Record<string, RecordData[]>;
  busy: boolean;
  onSave: (d: any) => Promise<any> | void;
}) {
  const fields = config[kind].fields || [];
  const defaults = Object.fromEntries(
    fields.map((f) => [
      f.key,
      f.type === 'checkbox'
        ? ['active', 'published'].includes(f.key)
        : f.type === 'number'
          ? f.min || 0
          : f.options?.[0] || '',
    ]),
  );
  const [data, setData] = useState<any>({ ...defaults, ...row }),
    [uploading, setUploading] = useState(false),
    [uploadError, setUploadError] = useState(''),
    [dirty, setDirty] = useState(false),
    [externalUpdate, setExternalUpdate] = useState(false);
  useEffect(() => {
    if (!dirty) {
      setData({ ...defaults, ...row });
      setExternalUpdate(false);
    } else setExternalUpdate(true);
  }, [row?.updatedAt]);
  const change = (key: string, value: any) => {
    setDirty(true);
    setData((d: any) => ({ ...d, [key]: value }));
  };
  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    setUploading(true);
    setUploadError('');
    try {
      const f = new FormData();
      f.append('image', e.target.files[0]);
      const r = await api('/api/admin/media/upload', { method: 'POST', body: f });
      change('image', r.url);
    } catch (e: any) {
      setUploadError(e.message);
    } finally {
      setUploading(false);
    }
  };
  return (
    <form
      className="editor"
      onSubmit={async (e) => {
        e.preventDefault();
        const body = Object.fromEntries(fields.map((f) => [f.key, data[f.key] ?? defaults[f.key]]));
        const result = await onSave(body);
        if (result) {
          setDirty(false);
          setExternalUpdate(false);
        }
      }}
    >
      {externalUpdate && (
        <p className="draft-notice" role="status">
          Settings changed elsewhere. Your unsaved edits have been kept.
        </p>
      )}
      <div className="form-grid">
        {fields.map((f) => {
          let options = f.options || [];
          if (f.key === 'brand') options = related.brands?.map((b) => b.name) || [];
          if (f.key === 'category') options = related.categories?.map((c) => c.name) || [];
          if (f.key === 'productId')
            options =
              related.products?.map((p) => ({ value: p.id, label: `${p.name} · ${p.packSize}` })) ||
              [];
          return f.type === 'checkbox' ? (
            <label className="checkbox-label" key={f.key}>
              <input
                type="checkbox"
                checked={!!data[f.key]}
                onChange={(e) => change(f.key, e.target.checked)}
              />
              {f.label}
            </label>
          ) : (
            <label
              className={f.type === 'textarea' || f.key === 'image' ? 'span-two' : ''}
              key={f.key}
            >
              {f.label}
              {f.required ? ' *' : ''}
              {f.type === 'select' ? (
                <select
                  required={f.required}
                  value={data[f.key] || ''}
                  onChange={(e) => change(f.key, e.target.value)}
                >
                  <option value="">Select…</option>
                  {options.map((o: any) => (
                    <option key={o.value || o} value={o.value || o}>
                      {o.label || o}
                    </option>
                  ))}
                </select>
              ) : f.type === 'textarea' ? (
                <textarea
                  rows={3}
                  required={f.required}
                  value={data[f.key] || ''}
                  onChange={(e) => change(f.key, e.target.value)}
                />
              ) : (
                <input
                  type={f.type || 'text'}
                  required={f.required}
                  min={f.min}
                  max={f.max}
                  step={f.type === 'number' ? '1' : undefined}
                  autoComplete={f.type === 'password' ? 'new-password' : undefined}
                  value={data[f.key] ?? ''}
                  onChange={(e) =>
                    change(f.key, f.type === 'number' ? Number(e.target.value) : e.target.value)
                  }
                />
              )}{' '}
              {f.help && <small>{f.help}</small>}
            </label>
          );
        })}
      </div>
      {kind === 'products' && (
        <div className="image-upload">
          <img src={data.image || '/images/hero-cluster.jpg'} alt="Product preview" />
          <div>
            <label className="button outline small">
              <Upload size={16} />
              {uploading ? 'Uploading…' : 'Upload product image'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={upload}
                disabled={uploading}
                hidden
              />
            </label>
            <small>JPEG, PNG or WebP · Up to 5 MB</small>
            <ErrorMessage error={uploadError} />
          </div>
        </div>
      )}
      <div className="editor-footer">
        <span>* Required fields</span>
        <button className="button green" disabled={busy || uploading}>
          {busy ? 'Saving…' : kind === 'batches' ? 'Receive stock' : 'Save changes'}
          <Check size={17} />
        </button>
      </div>
    </form>
  );
}

function QuoteEditor({
  row,
  initial,
  related,
  busy,
  onSave,
}: {
  row?: RecordData;
  initial?: any;
  related: Record<string, RecordData[]>;
  busy: boolean;
  onSave: (d: any) => void;
}) {
  const [d, setD] = useState<any>(
    row || {
      customerId: initial?.customerId || '',
      enquiryId: initial?.enquiryId || '',
      validUntil: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      notes: '',
      delivery: 0,
      deliveryTaxRate: 0,
      items: initial?.items?.length
        ? initial.items.map((i: any) => ({ ...i, rate: 0, discount: 0, taxRate: 0 }))
        : [{ productId: '', quantity: 1, rate: 0, discount: 0, taxRate: 0 }],
    },
  );
  const set = (key: string, value: any) => setD((x: any) => ({ ...x, [key]: value }));
  const changeLine = (i: number, key: string, value: any) =>
    setD((x: any) => ({
      ...x,
      items: x.items.map((item: any, index: number) =>
        index === i
          ? {
              ...item,
              [key]: value,
              ...(key === 'productId'
                ? { quantity: related.products.find((p) => p.id === value)?.minQuantity || 1 }
                : {}),
            }
          : item,
      ),
    }));
  const total =
    d.items.reduce(
      (s: number, i: any) =>
        s + Math.round(i.rate * 100 * i.quantity * (1 - i.discount / 100)) * (1 + i.taxRate / 100),
      0,
    ) +
    d.delivery * 100 * (1 + d.deliveryTaxRate / 100);
  return (
    <form
      className="quote-editor"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(d);
      }}
    >
      <div className="form-grid">
        <label>
          Customer *
          <select value={d.customerId} required onChange={(e) => set('customerId', e.target.value)}>
            <option value="">Select customer</option>
            {related.customers?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.business} · {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Valid until *
          <input
            type="date"
            min={today()}
            value={d.validUntil}
            required
            onChange={(e) => set('validUntil', e.target.value)}
          />
        </label>
        <label className="span-two">
          Linked enquiry
          <select value={d.enquiryId || ''} onChange={(e) => set('enquiryId', e.target.value)}>
            <option value="">No linked enquiry</option>
            {related.enquiries?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.reference} · {c.business || c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="quote-lines">
        <div className="panel-heading">
          <h3>Products & negotiated rates</h3>
          <span>Rates in INR per pack</span>
        </div>
        {d.items.map((item: any, i: number) => (
          <div className="quote-line" key={i}>
            <label className="quote-product">
              Product *
              <select
                required
                value={item.productId}
                onChange={(e) => changeLine(i, 'productId', e.target.value)}
              >
                <option value="">Select a product</option>
                {related.products?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.packSize}
                  </option>
                ))}
              </select>
            </label>
            {[
              ['quantity', 'Packs', 1],
              ['rate', 'Rate ₹', 0.01],
              ['discount', 'Discount %', 0],
              ['taxRate', 'GST %', 0],
            ].map(([key, label, min]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  required
                  min={Number(min)}
                  max={key === 'discount' ? 100 : key === 'taxRate' ? 40 : undefined}
                  step={key === 'quantity' ? '1' : '0.01'}
                  value={item[String(key)]}
                  onChange={(e) => changeLine(i, String(key), Number(e.target.value))}
                />
              </label>
            ))}
            <button
              className="icon-button"
              type="button"
              disabled={d.items.length === 1}
              aria-label={`Remove line ${i + 1}`}
              onClick={() =>
                set(
                  'items',
                  d.items.filter((_: any, j: number) => j !== i),
                )
              }
            >
              <X size={16} />
            </button>
          </div>
        ))}
        <button
          className="button outline small"
          type="button"
          onClick={() =>
            set('items', [
              ...d.items,
              { productId: '', quantity: 1, rate: 0, discount: 0, taxRate: 0 },
            ])
          }
        >
          <Plus size={16} /> Add product
        </button>
      </div>
      <div className="form-grid">
        <label>
          Delivery charge ₹ (before tax)
          <input
            type="number"
            min="0"
            step="0.01"
            value={d.delivery}
            onChange={(e) => set('delivery', Number(e.target.value))}
          />
        </label>
        <label>
          Delivery GST %
          <input
            type="number"
            min="0"
            max="40"
            step="0.01"
            value={d.deliveryTaxRate}
            onChange={(e) => set('deliveryTaxRate', Number(e.target.value))}
          />
        </label>
        <label className="span-two">
          Notes / agreed terms
          <textarea rows={3} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
        </label>
      </div>
      <div className="editor-footer">
        <div>
          <small>Estimated total including tax</small>
          <strong className="quote-total">{money(Math.round(total))}</strong>
        </div>
        <button className="button green" disabled={busy}>
          {busy ? 'Saving…' : 'Save draft quotation'}
          <Check size={17} />
        </button>
      </div>
    </form>
  );
}

function Details({
  kind,
  row: r,
  related,
  busy,
  user,
  execute,
  open,
  productName,
}: {
  kind: string;
  row: RecordData;
  related: Record<string, RecordData[]>;
  busy: boolean;
  user: User;
  execute: (f: () => Promise<any>, s?: string, c?: boolean) => Promise<any>;
  open: (v: any) => void;
  productName: (id: string) => string;
}) {
  const [staff, setStaff] = useState<RecordData[]>([]),
    [action, setAction] = useState('');
  useEffect(() => {
    if (kind === 'enquiries') void api('/api/admin/staff-options').then(setStaff);
  }, [kind]);
  const submit = (e: FormEvent<HTMLFormElement>, path: string, success: string) => {
    e.preventDefault();
    void execute(() => mutate(path, Object.fromEntries(new FormData(e.currentTarget))), success);
  };
  if (kind === 'products')
    return (
      <div className="record-detail">
        <div className="table-product">
          <img src={r.image} alt={r.name} />
          <div>
            <h2>{r.name}</h2>
            <p>
              {r.brand} · {r.category}
            </p>
          </div>
        </div>
        <p>{r.description}</p>
        <dl>
          <div>
            <dt>Pack</dt>
            <dd>{r.packSize}</dd>
          </div>
          <div>
            <dt>Minimum order</dt>
            <dd>{r.moq}</dd>
          </div>
          <div>
            <dt>Availability</dt>
            <dd>{r.availability}</dd>
          </div>
        </dl>
      </div>
    );
  if (kind === 'batches')
    return (
      <div className="record-detail">
        <h3>{productName(r.productId)}</h3>
        <p>
          Batch {r.batch} · Expires {dateLabel(r.expiry)}
        </p>
        <div className="detail-metrics">
          <div>
            <small>On hand</small>
            <b>{r.quantity}</b>
          </div>
          <div>
            <small>Reserved</small>
            <b>{r.reserved}</b>
          </div>
          <div>
            <small>Unreserved</small>
            <b>{r.quantity - r.reserved}</b>
          </div>
        </div>
        <h3>Adjust stock</h3>
        <form onSubmit={(e) => submit(e, `/api/admin/batches/${r.id}/adjust`, 'Stock adjusted')}>
          <div className="form-grid">
            <label>
              Quantity change
              <input
                name="quantity"
                type="number"
                required
                step="1"
                placeholder="e.g. -2 for damaged packs"
              />
            </label>
            <label>
              Reason / reference
              <input name="reason" required minLength={3} />
            </label>
          </div>
          <p className="muted">
            Use negative quantities for removals. Reserved packs cannot be removed.
          </p>
          <button className="button green" disabled={busy}>
            Record adjustment
          </button>
        </form>
      </div>
    );
  if (kind === 'enquiries')
    return (
      <div className="record-detail">
        <div className="detail-heading">
          <div>
            <h3>{r.business || r.name}</h3>
            <p>
              {r.name} · <a href={`tel:${r.phone}`}>{r.phone}</a> · {r.outletType}
            </p>
          </div>
          <Badge>{r.status}</Badge>
        </div>
        <p className="enquiry-message">{r.message || 'No additional message.'}</p>
        {r.interests?.length > 0 && (
          <div className="interest-chips">
            {r.interests.map((s: string) => (
              <span className="badge" key={s}>
                {s}
              </span>
            ))}
          </div>
        )}
        {r.items?.length > 0 && (
          <div className="detail-items">
            {r.items.map((i: any) => (
              <div key={i.productId}>
                <b>{i.name}</b>
                <span>
                  {i.quantity} × {i.packSize}
                </span>
              </div>
            ))}
          </div>
        )}
        <form onSubmit={(e) => submit(e, `/api/admin/enquiries/${r.id}/update`, 'Enquiry updated')}>
          <div className="form-grid">
            <label>
              Status
              <select name="status" defaultValue={r.status}>
                {['New', 'Contacted', 'Closed'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Assign to
              <select name="assignedTo" defaultValue={r.assignedTo}>
                <option value="">Unassigned</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Follow-up date
              <input name="followUp" type="date" defaultValue={r.followUp} />
            </label>
            <label className="span-two">
              Internal notes
              <textarea name="notes" defaultValue={r.notes} rows={3} />
            </label>
          </div>
          <div className="action-bar">
            <button className="button green" disabled={busy}>
              Save enquiry
            </button>
            <button
              className="button outline"
              type="button"
              disabled={busy}
              onClick={async () => {
                const c = await execute(
                  () => mutate(`/api/admin/enquiries/${r.id}/customer`, {}),
                  'Customer linked',
                  false,
                );
                if (c)
                  open({
                    type: 'quote',
                    initial: { customerId: c.id, enquiryId: r.id, items: r.items },
                  });
              }}
            >
              Prepare quotation <ArrowRight size={16} />
            </button>
          </div>
        </form>
      </div>
    );
  return (
    <div className="record-detail">
      <div className="detail-heading">
        <div>
          <h3>{r.customer?.business}</h3>
          <p>
            {r.customer?.name} · {r.customer?.phone}
          </p>
        </div>
        <Badge>{r.status}</Badge>
      </div>
      <p className="muted">{r.customer?.address || 'Customer address not configured'}</p>
      <div className="detail-items">
        {r.items?.map((i: any, index: number) => (
          <div key={index}>
            <div>
              <b>{i.name}</b>
              <small>
                {i.quantity} packs × {i.packSize}
                {user.role !== 'Warehouse' ? ` · ${i.taxRate}% GST` : ''}
              </small>
            </div>
            {user.role !== 'Warehouse' && <strong>{money(i.amount + i.tax)}</strong>}
          </div>
        ))}
      </div>
      {user.role !== 'Warehouse' && (
        <div className="detail-metrics">
          <div>
            <small>Total including tax</small>
            <b>{money(r.total)}</b>
          </div>
          {kind === 'orders' ? (
            <>
              <div>
                <small>Paid</small>
                <b>{money(r.paid)}</b>
              </div>
              <div>
                <small>Outstanding</small>
                <b>{money(r.total - r.paid)}</b>
              </div>
            </>
          ) : (
            <div>
              <small>Valid until</small>
              <b>{dateLabel(r.validUntil)}</b>
            </div>
          )}
        </div>
      )}
      {r.notes && <p className="enquiry-message">{r.notes}</p>}
      {kind === 'quotes' && (
        <>
          <div className="action-bar">
            <a className="button outline small" href={`/api/admin/quotes/${r.id}/pdf`}>
              <ArrowDownToLine size={16} /> Download PDF
            </a>
            {r.status === 'Draft' && (
              <>
                <button
                  className="button outline small"
                  onClick={() => open({ type: 'quote', row: r })}
                >
                  <Pencil size={15} /> Edit draft
                </button>
                <button
                  className="button green small"
                  disabled={busy}
                  onClick={() =>
                    void execute(
                      () => mutate(`/api/admin/quotes/${r.id}/status`, { status: 'Sent' }),
                      'Marked as sent',
                    )
                  }
                >
                  Mark as sent
                </button>
              </>
            )}
            {r.status === 'Sent' && (
              <>
                <button
                  className="button green small"
                  disabled={busy}
                  onClick={() => setAction('accept')}
                >
                  Record acceptance
                </button>
                <button
                  className="button outline small"
                  disabled={busy}
                  onClick={() =>
                    void execute(
                      () => mutate(`/api/admin/quotes/${r.id}/status`, { status: 'Declined' }),
                      'Quotation declined',
                    )
                  }
                >
                  Mark declined
                </button>
              </>
            )}
            {r.status === 'Accepted' && !r.orderId && (
              <button
                className="button green"
                disabled={busy}
                onClick={() =>
                  void execute(
                    () => mutate(`/api/admin/quotes/${r.id}/order`, {}),
                    'Order confirmed and stock reserved',
                  )
                }
              >
                Confirm order & reserve stock <ArrowRight size={17} />
              </button>
            )}
            {r.orderId && (
              <span className="success-message">
                <Check size={15} /> Converted to order
              </span>
            )}
          </div>
          {action === 'accept' && (
            <form
              className="inline-action"
              onSubmit={(e) =>
                submit(e, `/api/admin/quotes/${r.id}/status`, 'Customer acceptance recorded')
              }
            >
              <input type="hidden" name="status" value="Accepted" />
              <label>
                Acceptance record *
                <textarea
                  name="acceptanceNote"
                  required
                  placeholder="How and when did the customer accept? Include a reference."
                />
              </label>
              <button className="button green" disabled={busy}>
                Confirm acceptance
              </button>
            </form>
          )}
        </>
      )}
      {kind === 'orders' && (
        <>
          <div className="action-bar">
            {user.role !== 'Sales' && ['Confirmed', 'Packing', 'Dispatched'].includes(r.status) && (
              <button className="button green small" onClick={() => setAction('status')}>
                Update fulfilment <Truck size={16} />
              </button>
            )}
            {user.role !== 'Warehouse' && r.status !== 'Cancelled' && (
              <>
                {!r.invoiceId ? (
                  <button
                    className="button outline small"
                    disabled={busy}
                    onClick={() =>
                      void execute(
                        () => mutate(`/api/admin/orders/${r.id}/invoice`, {}),
                        'Invoice issued',
                      )
                    }
                  >
                    Issue invoice <FileText size={16} />
                  </button>
                ) : (
                  <>
                    <a
                      className="button outline small"
                      href={`/api/admin/invoices/${r.invoiceId}/pdf`}
                    >
                      Download invoice <ArrowDownToLine size={16} />
                    </a>
                    {r.paid < r.total && (
                      <button className="button green small" onClick={() => setAction('payment')}>
                        Record payment
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </div>
          {r.deliveryReference && (
            <p>
              Delivery reference: <strong>{r.deliveryReference}</strong>
            </p>
          )}
          {action === 'status' && (
            <form
              className="inline-action"
              onSubmit={(e) => submit(e, `/api/admin/orders/${r.id}/status`, 'Order updated')}
            >
              <div className="form-grid">
                <label>
                  Next status
                  <select name="status">
                    {(r.status === 'Confirmed'
                      ? ['Packing', 'Cancelled']
                      : r.status === 'Packing'
                        ? ['Dispatched', 'Cancelled']
                        : ['Delivered']
                    ).map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Delivery / dispatch reference
                  <input
                    name="deliveryReference"
                    defaultValue={r.deliveryReference}
                    placeholder="Required when dispatching"
                  />
                </label>
              </div>
              <button className="button green" disabled={busy}>
                Update order
              </button>
            </form>
          )}
          {action === 'payment' && (
            <form
              className="inline-action"
              onSubmit={(e) => submit(e, `/api/admin/orders/${r.id}/payment`, 'Payment recorded')}
            >
              <div className="form-grid">
                <label>
                  Amount received ₹
                  <input
                    name="amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    max={(r.total - r.paid) / 100}
                    required
                  />
                </label>
                <label>
                  Method
                  <select name="method">
                    {['Bank transfer', 'Cash', 'UPI', 'Cheque'].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Transaction reference
                  <input name="reference" required />
                </label>
                <label>
                  Payment date
                  <input type="date" name="date" defaultValue={today()} max={today()} required />
                </label>
              </div>
              <button className="button green" disabled={busy}>
                Record offline payment
              </button>
            </form>
          )}
          {r.payments?.length > 0 && (
            <div className="payment-history">
              <h3>Payment history</h3>
              {r.payments.map((p: any) => (
                <div className="alert-row" key={p.reference}>
                  <span>
                    {p.method} · {p.reference}
                    <small>{dateLabel(p.date)}</small>
                  </span>
                  <b>{money(p.amount)}</b>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
function Movements({ productName }: { productName: (id: string) => string }) {
  const [rows, setRows] = useState<any[] | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    api('/api/admin/movements')
      .then(setRows)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <div className="record-detail">
      <ErrorMessage error={error} />
      {!rows ? (
        <Loading />
      ) : rows.length ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Change</th>
                <th>Reason</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{productName(r.productId)}</td>
                  <td>
                    {r.quantity > 0 ? '+' : ''}
                    {r.quantity}
                  </td>
                  <td>{r.reason}</td>
                  <td>{dateLabel(r.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No stock movements yet" />
      )}
    </div>
  );
}
