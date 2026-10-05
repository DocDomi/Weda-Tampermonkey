// ==UserScript==
// @name         Ameli AAT - Sélection automatique de Non
// @namespace    local.ameli.aat
// @version      1.0.0
// @description  Sélectionne Non pour le motif manuel dès que le choix apparaît.
// @match        https://espacepro.ameli.fr/aatv3/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const TARGET_ID = 'motif-manuel-categorie-motif-radiogroup-label-text-1';
    const handled = new WeakSet();
    let scheduled = false;

    function selectNon() {
        if (!location.pathname.startsWith('/aatv3/')) return;

        const text = document.getElementById(TARGET_ID);
        if (!text || handled.has(text) || text.textContent.trim() !== 'Non') return;
        if (text.getClientRects().length === 0) return;
        const style = getComputedStyle(text);
        if (style.visibility === 'hidden' || style.visibility === 'collapse') return;

        const label = text.closest('label');
        const radio = label?.control ||
            text.closest('.v-radio, [role="radio"]')?.querySelector('input[type="radio"]');
        if (radio?.disabled || text.closest('[aria-disabled="true"], .v-radio--is-disabled')) return;

        // Une seule sélection par élément affiché : un choix manuel ultérieur reste possible.
        handled.add(text);
        if (radio?.checked || text.closest('[role="radio"][aria-checked="true"]')) return;

        // Le clic natif déclenche aussi les gestionnaires du formulaire Vue.
        if (radio?.type === 'radio') radio.click();
        else text.click();
    }

    function scheduleSelection() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            selectNon();
        });
    }

    // Le formulaire peut être ajouté après le chargement initial de la page.
    new MutationObserver(scheduleSelection).observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
    });
    scheduleSelection();
})();
