const mobileNav = document.querySelector('.sidebar');
const mobileNavToggle = document.querySelector('.mobile-nav-toggle');

function setMobileNavOpen(open) {
  mobileNav.classList.toggle('mobile-nav-open', open);
  mobileNavToggle.setAttribute('aria-expanded', String(open));
  mobileNavToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
}

mobileNavToggle.addEventListener('click', () => {
  setMobileNavOpen(mobileNavToggle.getAttribute('aria-expanded') !== 'true');
});

mobileNav.addEventListener('click', event => {
  if (event.target === mobileNav || event.target.closest('a, .nav-item, .help-button')) setMobileNavOpen(false);
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') setMobileNavOpen(false);
});

window.addEventListener('resize', () => {
  if (window.innerWidth > 700) setMobileNavOpen(false);
});
