import { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUpRight,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Coffee,
  Hotel,
  LockKeyhole,
  Menu,
  MessageCircle,
  Minus,
  Package,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  Snowflake,
  Soup,
  Truck,
  UtensilsCrossed,
  X,
  ChefHat,
  Croissant,
  GraduationCap,
  IceCreamBowl,
  Milk,
  Boxes,
  Leaf,
} from 'lucide-react';
import { api, mutate, type RecordData } from './api.js';
import { Logo, Modal, Empty, Loading, ErrorMessage } from './ui.js';
import { useSiteMotion } from './motion.js';
const categoryIcons = [Snowflake, Soup, ChefHat, Milk, IceCreamBowl, Boxes];
const outletTypes = [
  'Restaurant',
  'Café / Coffee Shop',
  'Hotel / Resort',
  'Fast Food / QSR',
  'Caterer',
  'Bakery / Pastry Shop',
  'Institution',
  'Cloud Kitchen',
  'Retail / Reseller',
];
export function PublicSite() {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(''),
    [category, setCategory] = useState('All'),
    [brand, setBrand] = useState('All brands'),
    [search, setSearch] = useState(''),
    [cart, setCart] = useState<Record<string, number>>({}),
    [detail, setDetail] = useState<RecordData | null>(null),
    [basket, setBasket] = useState(false),
    [menu, setMenu] = useState(false),
    [interests, setInterests] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [reference, setReference] = useState(''),
    [formError, setFormError] = useState(''),
    [requestKey, setRequestKey] = useState(crypto.randomUUID());
  useEffect(() => {
    let live = true,
      inFlight = false,
      version: string | undefined;
    const sync = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const next = await api('/api/catalogue');
        if (live) {
          if (version === undefined || next.version !== version) setData(next);
          version = next.version;
          setError('');
        }
      } catch (e: any) {
        if (live && version === undefined) setError(e.message);
      } finally {
        inFlight = false;
      }
    };
    void sync();
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') void sync();
    }, 15000);
    const resume = () => {
      if (document.visibilityState !== 'hidden') void sync();
    };
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, []);
  useSiteMotion([data, category, brand, search]);
  const settings = data?.settings || {},
    products: RecordData[] = data?.products || [],
    phone = settings.phone || '9818180167';
  const whatsapp = (message = 'Hello Horeca Yard! I would like wholesale rates for my business.') =>
    `https://wa.me/91${phone}?text=${encodeURIComponent(message)}`;
  const add = (p: RecordData) => {
    setCart((c) => ({ ...c, [p.id]: (c[p.id] || 0) + p.minQuantity }));
  };
  const selected = products.filter((p) => cart[p.id]);
  const filtered = products.filter(
    (p) =>
      (category === 'All' || p.category === category) &&
      (brand === 'All brands' || p.brand === brand) &&
      `${p.name} ${p.brand} ${p.category}`.toLowerCase().includes(search.toLowerCase()),
  );
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    const f = new FormData(e.currentTarget);
    try {
      const result = await mutate(
        '/api/enquiries',
        {
          name: f.get('name'),
          business: f.get('business'),
          phone: f.get('phone'),
          outletType: f.get('outletType'),
          message: f.get('message'),
          website: f.get('website'),
          interests,
          items: selected.map((p) => ({ productId: p.id, quantity: cart[p.id] })),
        },
        'POST',
        requestKey,
      );
      setReference(result.reference);
      setCart({});
      setRequestKey(crypto.randomUUID());
    } catch (e: any) {
      setFormError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const quoteLink = () => {
    setBasket(false);
    document.querySelector('#enquiry')?.scrollIntoView({ behavior: 'smooth' });
  };
  return (
    <>
      <a className="skip-link" href="#catalogue">
        Skip to catalogue
      </a>
      <header className="site-header">
        <div className="container header-inner">
          <Logo />
          <nav className={menu ? 'open' : ''} aria-label="Main navigation">
            {[
              ['CATALOGUE', 'catalogue'],
              ['WHY US', 'why'],
              ['WHO WE SERVE', 'serve'],
              ['ENQUIRE', 'enquiry'],
            ].map(([label, id]) => (
              <a key={id} href={'#' + id} onClick={() => setMenu(false)}>
                {label}
              </a>
            ))}
          </nav>
          <div className="header-actions">
            <a href="/admin/login" className="icon-button admin-link" aria-label="Admin login">
              <LockKeyhole size={16} />
            </a>
            <a className="phone-pill" href={`tel:+91${phone}`}>
              <Phone size={15} />
              <span>{phone}</span>
            </a>
            <button
              className="icon-button mobile-menu"
              aria-label="Toggle navigation"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              {menu ? <X /> : <Menu />}
            </button>
          </div>
        </div>
      </header>
      <main>
        <section className="hero container" id="top">
          <div className="hero-outline" aria-hidden="true">
            BULK
          </div>
          <div className="hero-grid">
            <div className="hero-copy">
              <p className="eyebrow">
                <span />
                YOUR TRUSTED WHOLESALE PARTNER · PAN INDIA
              </p>
              <h1>
                {settings.heroTitle &&
                settings.heroTitle !== 'PREMIUM HORECA PRODUCTS AT WHOLESALE PRICES.' ? (
                  settings.heroTitle
                ) : (
                  <>
                    PREMIUM HORECA
                    <br />
                    PRODUCTS AT
                    <br />
                    <mark>WHOLESALE</mark> PRICES.
                  </>
                )}
              </h1>
              <p className="hero-description">
                {settings.heroDescription ||
                  'Genuine brands. Better bulk rates. Everything your kitchen needs, from one trusted wholesale partner.'}
              </p>
              <div className="hero-buttons">
                <a className="button green" href="#catalogue">
                  Browse the catalogue <ArrowDown size={18} />
                </a>
                <a className="button yellow" href={whatsapp()} target="_blank" rel="noreferrer">
                  <MessageCircle size={18} /> Order on WhatsApp
                </a>
              </div>
              <div className="hero-note">
                <ShieldCheck size={16} />
                <span>Trusted brands. Genuine products. Bulk only.</span>
              </div>
            </div>
            <div className="hero-visual">
              <div className="round-seal">
                <span>BEST PRICES</span>
                <b>HY</b>
                <span>BULK ORDERS</span>
              </div>
              <div className="hero-image">
                <img
                  src="/images/hero-cluster.jpg"
                  alt="McCain, Hungritos and Veeba wholesale product packs"
                  fetchPriority="high"
                />
                <div>
                  <ShieldCheck size={15} /> 100% GENUINE PRODUCTS
                </div>
              </div>
              <div className="hero-floating">
                <Package size={23} />
                <span>
                  Big on quality.
                  <br />
                  <strong>Bigger on savings.</strong>
                </span>
              </div>
            </div>
          </div>
          <div className="hero-stats">
            <div>
              <strong>
                500<span>+</span>
              </strong>
              <small>HORECA OUTLETS SERVED</small>
            </div>
            <div>
              <strong>06</strong>
              <small>PRODUCT CATEGORIES</small>
            </div>
            <div>
              <strong>
                24<span>hr</span>
              </strong>
              <small>ORDER DISPATCH</small>
            </div>
            <div>
              <strong>Pan India</strong>
              <small>FAST & RELIABLE DELIVERY</small>
            </div>
          </div>
        </section>
        <div className="brand-band">
          <div className="container">
            <span className="eyebrow">
              BRANDS YOUR
              <br />
              KITCHEN TRUSTS
            </span>
            {['VEEBA', 'McCain', 'ITC MASTER CHEF', 'HUNGRITOS', 'FUNFOODS', 'AMUL'].map((b) => (
              <span className="brand-word" key={b}>
                {b}
              </span>
            ))}
          </div>
        </div>
        <section className="catalogue container section" id="catalogue">
          <div className="section-heading">
            <div>
              <p className="eyebrow">THE WHOLESALE LIST</p>
              <h2>
                THE CATALOGUE<span>.</span>
              </h2>
              <p className="section-subtitle">
                Bulk only. Best prices. All your kitchen essentials.
              </p>
            </div>
            <span className="tiny-tag">
              <Leaf size={16} /> QUALITY IN EVERY PACK
            </span>
          </div>
          <div className="catalogue-toolbar">
            <div className="search-field">
              <Search size={19} />
              <input
                placeholder="Search products or brands…"
                aria-label="Search catalogue"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  className="icon-button"
                  aria-label="Clear search"
                  onClick={() => setSearch('')}
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <select
              aria-label="Filter by brand"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
            >
              <option>All brands</option>
              {data?.brands.map((b: RecordData) => (
                <option key={b.id}>{b.name}</option>
              ))}
            </select>
            <button className="button basket-button" onClick={() => setBasket(true)}>
              <ShoppingBag size={18} /> Your enquiry <span>{selected.length}</span>
            </button>
          </div>
          <div className="category-tabs" aria-label="Product categories">
            <button
              className={category === 'All' ? 'active' : ''}
              onClick={() => setCategory('All')}
            >
              <Boxes size={16} /> All products
            </button>
            {data?.categories.map((c: RecordData, i: number) => {
              const Icon = categoryIcons[i % 6];
              return (
                <button
                  key={c.id}
                  className={category === c.name ? 'active' : ''}
                  onClick={() => setCategory(c.name)}
                >
                  <Icon size={16} />
                  {c.name}
                </button>
              );
            })}
          </div>
          {error ? (
            <>
              <ErrorMessage error={error} />
              <button className="button" onClick={() => location.reload()}>
                Try again
              </button>
            </>
          ) : !data ? (
            <Loading />
          ) : (
            <>
              <div className="results-caption">
                <span>{filtered.length} products</span>
                <span>
                  Wholesale rates available on request <ArrowUpRight size={13} />
                </span>
              </div>
              {filtered.length ? (
                <div className="product-grid">
                  {filtered.map((p) => (
                    <article className="product-card" key={p.id}>
                      <button
                        className="product-picture"
                        onClick={() => setDetail(p)}
                        aria-label={`View ${p.name}`}
                      >
                        <img
                          src={p.image || '/images/hero-cluster.jpg'}
                          alt={`${p.brand} ${p.name}`}
                          loading="lazy"
                        />
                        {p.featured && <span className="best-tag">KITCHEN FAVOURITE</span>}
                        <span className="picture-arrow">
                          <ArrowUpRight size={18} />
                        </span>
                      </button>
                      <div className="product-info">
                        <span className="product-brand">{p.brand}</span>
                        <button className="product-name" onClick={() => setDetail(p)}>
                          {p.name}
                        </button>
                        <div className="pack-line">
                          <Package size={14} />
                          {p.packSize}
                          <span>•</span>
                          {p.category}
                        </div>
                        <p className="moq">
                          MOQ <strong>{p.moq}</strong>
                        </p>
                        <div className="product-bottom">
                          <span
                            className={`availability ${p.availability === 'Unavailable' ? 'unavailable' : ''}`}
                          >
                            <i />
                            {p.availability === 'On request'
                              ? 'Check availability'
                              : p.availability}
                          </span>
                          <button
                            className={cart[p.id] ? 'added' : ''}
                            disabled={p.availability === 'Unavailable'}
                            onClick={() => add(p)}
                            aria-label={`Add ${p.name} to enquiry`}
                          >
                            {cart[p.id] ? <Check size={17} /> : <Plus size={18} />}{' '}
                            {cart[p.id] ? `${cart[p.id]} packs` : 'Enquire'}
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <Empty title="No products found">Try another search, brand, or category.</Empty>
              )}
            </>
          )}
          <div className="catalogue-help">
            <div>
              <MessageCircle size={22} />
              <span>
                Can’t find what your kitchen needs? <strong>We’ll help you source it.</strong>
              </span>
            </div>
            <a
              href={whatsapp('Hello Horeca Yard! I need help sourcing products for my kitchen.')}
              target="_blank"
              rel="noreferrer"
            >
              Talk to our team <ArrowRight size={17} />
            </a>
          </div>
        </section>
        <section className="promise" id="why">
          <div className="container promise-grid">
            <div>
              <p className="eyebrow">THE HORECA YARD PROMISE</p>
              <h2>
                MORE QUANTITY.
                <br />
                <span>MORE SAVINGS.</span>
              </h2>
              <p className="promise-intro">That’s the whole business model.</p>
              <div className="promise-stamp">
                <ShieldCheck size={36} />
                <div>
                  YOUR KITCHEN.
                  <br />
                  <b>OUR COMMITMENT.</b>
                </div>
              </div>
            </div>
            <div className="promise-list">
              {[
                [
                  'Direct factory pricing',
                  'We buy at source, in volume. Better wholesale rates help keep more margin in your business.',
                ],
                [
                  'Cold-chain, unbroken',
                  'Temperature-controlled storage and delivery keep your frozen essentials ready for service.',
                ],
                [
                  'Genuine brands, always',
                  'The brands you know, with proper billing. Quality your kitchen can rely on.',
                ],
                [
                  'A partner, not a vendor',
                  'One call. One WhatsApp message. A dedicated partner for your kitchen’s everyday needs.',
                ],
              ].map(([t, d], i) => (
                <div key={t}>
                  <span>0{i + 1}</span>
                  <div>
                    <h3>{t}</h3>
                    <p>{d}</p>
                  </div>
                  <ArrowUpRight size={20} />
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="container section serve" id="serve">
          <div className="section-heading">
            <div>
              <p className="eyebrow">WHO WE SERVE</p>
              <h2>
                FOR EVERY KITCHEN<span>.</span>
              </h2>
              <p className="section-subtitle">For every business. We deliver.</p>
            </div>
            <UtensilsCrossed size={45} strokeWidth={1} />
          </div>
          <div className="serve-grid">
            {[
              [UtensilsCrossed, 'Restaurants', 'FULL KITCHEN SUPPLY'],
              [Coffee, 'Cafés & Coffee Shops', 'SNACKS & SAUCES'],
              [Hotel, 'Hotels & Resorts', 'BANQUET-SCALE VOLUMES'],
              [Soup, 'Fast Food Outlets', 'QSR-READY FROZEN RANGE'],
              [ChefHat, 'Caterers', 'EVENT-SCALE BULK ORDERS'],
              [Croissant, 'Bakeries & Pastries', 'DAIRY, CHEESE & DESSERTS'],
              [GraduationCap, 'Schools & Institutions', 'SAFE, BILLED, GENUINE'],
              [Truck, 'Cloud Kitchens', 'LEAN, FAST, RELIABLE'],
            ].map(([Icon, title, desc]: any) => (
              <div key={title}>
                <Icon size={29} strokeWidth={1.4} />
                <h3>{title}</h3>
                <small>{desc}</small>
              </div>
            ))}
          </div>
        </section>
        <section className="enquiry-section" id="enquiry">
          <div className="container enquiry-grid">
            <div className="enquiry-copy">
              <p className="eyebrow">LET’S TALK BULK</p>
              <h2>
                STOP PAYING
                <br />
                <span>RETAIL.</span>
              </h2>
              <p>Get your wholesale quote today.</p>
              <ul>
                <li>
                  <CheckCircle2 size={18} /> Competitive rates on genuine products
                </li>
                <li>
                  <CheckCircle2 size={18} /> Bigger orders, bigger savings
                </li>
                <li>
                  <CheckCircle2 size={18} /> Fast & reliable delivery, Pan India
                </li>
              </ul>
              <div className="call-block">
                <span>CALL US NOW</span>
                <a href={`tel:+91${phone}`}>
                  <Phone size={27} />
                  {phone}
                </a>
              </div>
              <a className="whatsapp-text" href={whatsapp()} target="_blank" rel="noreferrer">
                <MessageCircle size={19} /> Continue on WhatsApp <ArrowUpRight size={17} />
              </a>
            </div>
            <div className="enquiry-form-wrap">
              {reference ? (
                <div className="success-card" role="status">
                  <CheckCircle2 size={52} />
                  <p className="eyebrow">ENQUIRY RECEIVED</p>
                  <h3>Your kitchen is in good hands.</h3>
                  <p>Our team will contact you to discuss availability and wholesale rates.</p>
                  <div className="reference">
                    Reference <strong>{reference}</strong>
                  </div>
                  <button className="button green" onClick={() => setReference('')}>
                    Send another enquiry <ArrowRight size={17} />
                  </button>
                </div>
              ) : (
                <form onSubmit={submit}>
                  <div className="form-intro">
                    <h3>A better rate starts here.</h3>
                    <span>No account needed.</span>
                  </div>
                  <div className="form-grid">
                    <label>
                      Your name *
                      <input
                        name="name"
                        required
                        minLength={2}
                        maxLength={300}
                        autoComplete="name"
                        placeholder="Full name"
                      />
                    </label>
                    <label>
                      Business name
                      <input
                        name="business"
                        maxLength={300}
                        autoComplete="organization"
                        placeholder="Your restaurant or business"
                      />
                    </label>
                    <label>
                      Phone number *
                      <input
                        name="phone"
                        required
                        pattern="\+?[0-9\s()\-]{10,18}"
                        autoComplete="tel"
                        placeholder="Your contact number"
                        type="tel"
                      />
                    </label>
                    <label>
                      Outlet type
                      <select name="outletType">
                        {outletTypes.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <fieldset>
                    <legend>Interested in</legend>
                    <div className="interest-chips">
                      {data?.categories.map((c: RecordData) => (
                        <button
                          key={c.id}
                          type="button"
                          aria-pressed={interests.includes(c.name)}
                          className={interests.includes(c.name) ? 'selected' : ''}
                          onClick={() =>
                            setInterests((v) =>
                              v.includes(c.name) ? v.filter((n) => n !== c.name) : [...v, c.name],
                            )
                          }
                        >
                          {interests.includes(c.name) && <Check size={12} />} {c.name}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  {selected.length > 0 && (
                    <button
                      type="button"
                      className="selected-summary"
                      onClick={() => setBasket(true)}
                    >
                      <ShoppingBag size={17} />
                      {selected.length} products in your enquiry <ChevronRight size={16} />
                    </button>
                  )}
                  <label>
                    Tell us what you need
                    <textarea
                      name="message"
                      rows={3}
                      maxLength={3000}
                      placeholder="Products, quantities, delivery location…"
                    />
                  </label>
                  <div className="honeypot" aria-hidden="true">
                    <label>
                      Website
                      <input name="website" tabIndex={-1} autoComplete="off" />
                    </label>
                  </div>
                  <ErrorMessage error={formError} />
                  <button className="button green submit-enquiry" disabled={busy}>
                    {busy ? 'Sending your enquiry…' : 'Request wholesale quote'}
                    <ArrowUpRight size={20} />
                  </button>
                  <p className="form-note">We’ll use your details to respond to this enquiry.</p>
                </form>
              )}
            </div>
          </div>
        </section>
      </main>
      <footer className="site-footer">
        <div className="container footer-grid">
          <div>
            <Logo light />
            <p>
              Your trusted partner for
              <br />a better-stocked kitchen.
            </p>
          </div>
          <div>
            <span className="eyebrow">REACH US</span>
            <a href={`tel:+91${phone}`}>+91 {phone}</a>
            <a href={whatsapp()} target="_blank" rel="noreferrer">
              WhatsApp orders <ArrowUpRight size={13} />
            </a>
            <a
              href={settings.instagram || 'https://www.instagram.com/horecayard/'}
              target="_blank"
              rel="noreferrer"
            >
              @horecayard <ArrowUpRight size={13} />
            </a>
          </div>
          <div>
            <span className="eyebrow">OUR RANGE</span>
            <p>
              Frozen foods · Sauces & dressings
              <br />
              Ready-to-cook gravies · Dairy & cheese
              <br />
              Frozen desserts · Disposables
            </p>
          </div>
          <div>
            <span className="eyebrow">DELIVERING BETTER</span>
            <p>
              Pan India delivery.
              <br />
              Genuine products. Proper billing.
              <br />
              Bulk orders welcome.
            </p>
          </div>
        </div>
        <div className="container footer-bottom">
          <span>© {new Date().getFullYear()} HORECA YARD</span>
          <span>BETTER PRODUCTS. BETTER PRICES. BETTER BUSINESS.</span>
          <a href="/admin/login">
            ADMIN LOGIN <ArrowUpRight size={12} />
          </a>
        </div>
      </footer>
      <a
        className="floating-whatsapp"
        href={whatsapp()}
        target="_blank"
        rel="noreferrer"
        aria-label="Chat on WhatsApp"
      >
        <MessageCircle size={26} />
      </a>
      {detail && (
        <Modal title="Product details" onClose={() => setDetail(null)}>
          <div className="product-detail">
            <img src={detail.image} alt={detail.name} />
            <p className="product-brand">{detail.brand}</p>
            <h2>{detail.name}</h2>
            <p>{detail.description}</p>
            <dl>
              <div>
                <dt>Pack size</dt>
                <dd>{detail.packSize}</dd>
              </div>
              <div>
                <dt>Minimum order</dt>
                <dd>{detail.moq}</dd>
              </div>
              <div>
                <dt>Availability</dt>
                <dd>{detail.availability}</dd>
              </div>
            </dl>
            <button
              className="button green"
              disabled={detail.availability === 'Unavailable'}
              onClick={() => {
                add(detail);
                setDetail(null);
                setBasket(true);
              }}
            >
              Add to wholesale enquiry <Plus size={18} />
            </button>
          </div>
        </Modal>
      )}
      {basket && (
        <Modal title="Your wholesale enquiry" onClose={() => setBasket(false)}>
          {selected.length ? (
            <>
              <div className="basket-list">
                {selected.map((p) => (
                  <div className="basket-row" key={p.id}>
                    <img src={p.image} alt="" />
                    <div>
                      <strong>{p.name}</strong>
                      <small>
                        {p.packSize} · Minimum {p.minQuantity} packs
                      </small>
                      <div className="quantity">
                        <button
                          aria-label={`Reduce ${p.name}`}
                          disabled={cart[p.id] <= p.minQuantity}
                          onClick={() =>
                            setCart((c) => ({ ...c, [p.id]: Math.max(p.minQuantity, c[p.id] - 1) }))
                          }
                        >
                          <Minus size={13} />
                        </button>
                        <input
                          aria-label={`Quantity of ${p.name}`}
                          type="number"
                          min={p.minQuantity}
                          max={100000}
                          value={cart[p.id]}
                          onChange={(e) =>
                            setCart((c) => ({
                              ...c,
                              [p.id]: Math.max(
                                p.minQuantity,
                                Math.min(100000, Number(e.target.value) || p.minQuantity),
                              ),
                            }))
                          }
                        />
                        <button
                          aria-label={`Increase ${p.name}`}
                          onClick={() =>
                            setCart((c) => ({ ...c, [p.id]: Math.min(100000, c[p.id] + 1) }))
                          }
                        >
                          <Plus size={13} />
                        </button>
                        <span>packs</span>
                      </div>
                    </div>
                    <button
                      className="icon-button"
                      aria-label={`Remove ${p.name}`}
                      onClick={() =>
                        setCart((c) => {
                          const n = { ...c };
                          delete n[p.id];
                          return n;
                        })
                      }
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
              <p className="muted">
                Our team will confirm availability, delivery, and your negotiated rates.
              </p>
              <button className="button green full" onClick={quoteLink}>
                Add your contact details <ArrowRight size={18} />
              </button>
            </>
          ) : (
            <Empty title="Your enquiry is empty">
              Add products from the catalogue to request a tailored wholesale quote.
            </Empty>
          )}
        </Modal>
      )}
    </>
  );
}
