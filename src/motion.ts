import { useEffect } from 'react';

/** Progressive enhancement: content remains visible without JavaScript or with reduced motion. */
export function useSiteMotion(dependencies: unknown[]) {
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (preference.matches || typeof IntersectionObserver === 'undefined') return;
    const targets = document.querySelectorAll<HTMLElement>(
      '.section-heading, .product-card, .catalogue-help, .promise-grid > div, .serve-grid > div, .enquiry-copy, .enquiry-form-wrap, .footer-grid > div, .hero-stats > div',
    );
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view');
            observer.unobserve(entry.target);
          }
      },
      { threshold: 0.08, rootMargin: '0px 0px -24px 0px' },
    );
    for (const element of targets) {
      if (element.classList.contains('in-view')) continue;
      element.classList.add('scroll-reveal');
      const siblings = Array.from(element.parentElement?.children || []);
      const grouped = element.matches(
        '.product-card, .serve-grid > div, .hero-stats > div, .footer-grid > div',
      );
      element.style.setProperty(
        '--reveal-delay',
        grouped ? `${(siblings.indexOf(element) % 4) * 65}ms` : '0ms',
      );
      observer.observe(element);
    }
    const revealAll = () => targets.forEach((e) => e.classList.add('in-view'));
    preference.addEventListener('change', revealAll);
    return () => {
      observer.disconnect();
      preference.removeEventListener('change', revealAll);
      targets.forEach((e) => {
        if (!e.classList.contains('in-view')) e.classList.remove('scroll-reveal');
      });
    };
  }, dependencies);
}
