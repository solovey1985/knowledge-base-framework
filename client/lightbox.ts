interface LightboxItem {
  src: string;
  name: string;
}

interface LightboxState {
  galleryId: string;
  index: number;
  items: LightboxItem[];
}

export function initLightbox(): void {
  const lightbox = document.querySelector<HTMLElement>('[data-kb-lightbox]');
  if (!lightbox) return;

  const imageEl = lightbox.querySelector<HTMLImageElement>('[data-kb-lightbox-image]');
  const captionEl = lightbox.querySelector<HTMLElement>('[data-kb-lightbox-caption]');
  const closeButtons = lightbox.querySelectorAll('[data-kb-lightbox-close]');
  const prevButton = lightbox.querySelector<HTMLElement>('[data-kb-lightbox-prev]');
  const nextButton = lightbox.querySelector<HTMLElement>('[data-kb-lightbox-next]');
  const zoomButton = lightbox.querySelector<HTMLElement>('[data-kb-lightbox-zoom]');

  const state: LightboxState = {
    galleryId: '',
    index: 0,
    items: []
  };

  const galleries = new Map<string, HTMLElement[]>();

  document.querySelectorAll<HTMLElement>('[data-kb-lightbox-gallery]').forEach(gallery => {
    const galleryId = gallery.getAttribute('data-kb-lightbox-gallery');
    if (!galleryId) return;
    const triggers = Array.from(gallery.querySelectorAll<HTMLElement>('[data-kb-lightbox-trigger]'));
    galleries.set(galleryId, triggers);

    triggers.forEach((trigger, index) => {
      trigger.dataset.kbGallery = galleryId;
      trigger.dataset.kbIndex = String(index);
      trigger.addEventListener('click', event => {
        event.preventDefault();
        openGallery(galleryId, index);
      });
    });
  });

  function openGallery(galleryId: string, index: number) {
    const triggers = galleries.get(galleryId);
    if (!triggers || !imageEl) return;

    state.galleryId = galleryId;
    state.index = index;
    state.items = triggers.map(trigger => ({
      src: trigger.getAttribute('data-image-src') || '',
      name: trigger.getAttribute('data-image-name') || ''
    }));

    render();
    lightbox.classList.add('is-visible');
    document.body.classList.add('kb-lightbox-open');
  }

  function close() {
    lightbox.classList.remove('is-visible');
    lightbox.classList.remove('is-zoomed');
    document.body.classList.remove('kb-lightbox-open');
  }

  function render() {
    if (!imageEl) return;
    const item = state.items[state.index];
    imageEl.src = item?.src || '';
    if (captionEl) {
      captionEl.textContent = item?.name || '';
    }
    prevButton?.setAttribute('aria-disabled', state.index === 0 ? 'true' : 'false');
    nextButton?.setAttribute('aria-disabled', state.index === state.items.length - 1 ? 'true' : 'false');
  }

  closeButtons.forEach(btn => btn.addEventListener('click', close));
  lightbox.addEventListener('click', event => {
    if (event.target === lightbox) {
      close();
    }
  });

  document.addEventListener('keydown', event => {
    if (!lightbox.classList.contains('is-visible')) return;
    if (event.key === 'Escape') {
      close();
    }
    if (event.key === 'ArrowLeft') {
      goTo(state.index - 1);
    }
    if (event.key === 'ArrowRight') {
      goTo(state.index + 1);
    }
  });

  prevButton?.addEventListener('click', () => goTo(state.index - 1));
  nextButton?.addEventListener('click', () => goTo(state.index + 1));
  zoomButton?.addEventListener('click', () => {
    lightbox.classList.toggle('is-zoomed');
  });

  function goTo(index: number) {
    if (index < 0 || index >= state.items.length) return;
    state.index = index;
    render();
  }
}
