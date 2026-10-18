/* ShotThink shared preferences for extension pages: language and theme.
 *
 * Both pages need identical behaviour here, so it lives in one file. Language
 * defaults to the browser language (i18n.js already resolved that) and is only
 * overridden when the user has explicitly chosen one.
 */

(function () {
  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  let themePreference = 'system';

  function resolveTheme() {
    if (themePreference === 'light') return 'light';
    if (themePreference === 'dark') return 'dark';
    return darkQuery.matches ? 'dark' : 'light';
  }

  function paintTheme() {
    document.documentElement.dataset.theme = resolveTheme();
    const seg = document.getElementById('themeSeg');
    if (!seg) return;
    for (const button of seg.querySelectorAll('[data-theme-opt]')) {
      button.setAttribute('aria-pressed', String(button.dataset.themeOpt === themePreference));
    }
  }

  darkQuery.addEventListener('change', () => {
    if (themePreference === 'system') paintTheme();
  });

  function paintLanguage(lang) {
    const seg = document.getElementById('langSeg');
    if (seg) {
      for (const button of seg.querySelectorAll('[data-lang]')) {
        button.setAttribute('aria-pressed', String(button.dataset.lang === lang));
      }
    }
    shotThinkLocalizePage();
  }

  /**
   * Load and apply stored preferences.
   * Returns the resolved language so callers can localise after rendering.
   */
  window.shotThinkLoadPrefs = async function () {
    const { uiLanguage, uiTheme } = await chrome.storage.local.get(['uiLanguage', 'uiTheme']);
    const lang = uiLanguage === 'en' || uiLanguage === 'zh' ? uiLanguage : shotThinkLang;
    themePreference = uiTheme === 'light' || uiTheme === 'dark' || uiTheme === 'system'
      ? uiTheme
      : 'system';

    shotThinkSetLanguage(lang);
    paintTheme();
    paintLanguage(lang);

    document.getElementById('langSeg')?.addEventListener('click', async event => {
      const button = event.target.closest('[data-lang]');
      if (!button) return;
      const next = button.dataset.lang;
      await chrome.storage.local.set({ uiLanguage: next });
      shotThinkSetLanguage(next);
      paintLanguage(next);
      // Callers re-render so dynamically built text picks up the new language.
      document.dispatchEvent(new CustomEvent('shotthink:language', { detail: next }));
    });

    document.getElementById('themeSeg')?.addEventListener('click', async event => {
      const button = event.target.closest('[data-theme-opt]');
      if (!button) return;
      themePreference = button.dataset.themeOpt;
      await chrome.storage.local.set({ uiTheme: themePreference });
      paintTheme();
    });

    return lang;
  };
})();
