(() => {
  const navToggle = document.querySelector('[data-nav-toggle]');
  const navMenu = document.querySelector('[data-nav-menu]');

  if (navToggle && navMenu) {
    navToggle.addEventListener('click', () => {
      const expanded = navToggle.getAttribute('aria-expanded') === 'true';
      navToggle.setAttribute('aria-expanded', String(!expanded));
      navMenu.classList.toggle('is-open');
    });

    navMenu.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        if (navMenu.classList.contains('is-open')) {
          navMenu.classList.remove('is-open');
          navToggle.setAttribute('aria-expanded', 'false');
        }
      });
    });
  }

  const scrollTopBtn = document.getElementById('scrollTopBtn');

  if (scrollTopBtn) {
    const toggleVisibility = () => {
      const isVisible = window.scrollY > 240;
      scrollTopBtn.classList.toggle('is-visible', isVisible);
    };

    window.addEventListener('scroll', toggleVisibility, { passive: true });
    toggleVisibility();

    scrollTopBtn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  const postFeed = document.querySelector('.post-feed');
  const blogSearchForm = document.querySelector('.blog-search');

  if (postFeed && blogSearchForm) {
    // Enable client-side filtering of blog posts by keyword and trending tag.
    const searchInput = blogSearchForm.querySelector('input[type="search"]');
    const tagPills = Array.from(document.querySelectorAll('.tag-stack .tag-pill'));
    const cards = Array.from(postFeed.querySelectorAll('.post-card')).filter(
      (card) => !card.classList.contains('placeholder'),
    );

    if (!cards.length) {
      return;
    }

    const normalizeText = (value = '') => {
      const lower = value.toLowerCase();
      const normalized = typeof lower.normalize === 'function' ? lower.normalize('NFKD') : lower;
      return normalized.replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
    };

    const cardData = cards.map((card) => {
      const title = card.querySelector('.post-title')?.textContent ?? '';
      const description = card.querySelector('.post-description')?.textContent ?? '';
      const meta = card.querySelector('.post-meta')?.textContent ?? '';
      const tags = Array.from(card.querySelectorAll('.post-tags .tag-pill')).map((pill) =>
        normalizeText(pill.textContent ?? ''),
      );

      return {
        element: card,
        searchText: normalizeText([title, description, meta, tags.join(' ')].join(' ')),
        tags,
      };
    });

    const lang = document.documentElement.lang || 'en';
    let emptyState = postFeed.querySelector('.post-card.no-results');

    if (!emptyState) {
      emptyState = document.createElement('article');
      emptyState.className = 'post-card placeholder no-results is-hidden';
      const emptyMessage =
        lang === 'ja'
          ? '条件に一致する記事が見つかりません。キーワードやタグを変えて再度お試しください。'
          : 'No posts match your filters. Try a different keyword or tag.';
      emptyState.innerHTML = `
        <div class="post-link" aria-live="polite">
          <div class="post-meta">
            <span>${lang === 'ja' ? '状態' : 'Status'}</span>
            <span>${lang === 'ja' ? '検索結果なし' : 'No matches'}</span>
          </div>
          <h2 class="post-title">${lang === 'ja' ? '該当する記事がありません' : 'No articles found'}</h2>
          <p class="post-description">${emptyMessage}</p>
        </div>
      `;
      postFeed.appendChild(emptyState);
    }

    let activeTag = null;

    const setActiveTag = (tagValue, pill) => {
      activeTag = tagValue;
      tagPills.forEach((button) => {
        const isCurrent = !!pill && button === pill;
        const shouldActivate = tagValue && isCurrent;
        button.classList.toggle('is-active', shouldActivate);
        button.setAttribute('aria-pressed', shouldActivate ? 'true' : 'false');
      });

      if (!tagValue) {
        tagPills.forEach((button) => {
          button.classList.remove('is-active');
          button.setAttribute('aria-pressed', 'false');
        });
      }
    };

    const initialActive = tagPills.find((pill) => pill.classList.contains('is-active'));
    if (initialActive) {
      setActiveTag(normalizeText(initialActive.textContent ?? ''), initialActive);
    }

    const applyFilters = () => {
      const query = searchInput ? normalizeText(searchInput.value ?? '') : '';
      const terms = query ? query.split(' ').filter(Boolean) : [];
      let visibleCount = 0;

      cardData.forEach((card) => {
        const matchesSearch = terms.every((term) => card.searchText.includes(term));
        const matchesTag = !activeTag || card.tags.includes(activeTag);
        const isVisible = matchesSearch && matchesTag;
        card.element.classList.toggle('is-hidden', !isVisible);
        if (isVisible) {
          visibleCount += 1;
        }
      });

      emptyState.classList.toggle('is-hidden', visibleCount > 0);
    };

    blogSearchForm.addEventListener('submit', (event) => {
      event.preventDefault();
      applyFilters();
    });

    if (searchInput) {
      const handleSearchInput = () => applyFilters();
      searchInput.addEventListener('input', handleSearchInput);
      searchInput.addEventListener('search', handleSearchInput);
    }

    tagPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        const tagValue = normalizeText(pill.textContent ?? '');
        if (activeTag && activeTag === tagValue) {
          setActiveTag(null, null);
        } else {
          setActiveTag(tagValue, pill);
        }
        applyFilters();
      });
    });

    applyFilters();
  }
})();
