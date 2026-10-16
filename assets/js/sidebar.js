// Navigation controller shared by the authenticated Hub views.
window.createMicaSidebar = function createMicaSidebar() {
  "use strict";
  var panel = document.getElementById("mica-sidebar");
  if (!panel) return null;
  if (panel._micaSidebar) return panel._micaSidebar;
  var shell = panel.closest(".app-shell"), workspace = shell.querySelector(".workspace");
  var media = window.matchMedia("(max-width: 820px)");
  var indicator = panel.querySelector(".sidebar-indicator");
  var nav = panel.querySelector(".sidebar-nav-frame");
  var expanded = true, mobileOpen = false, currentView = "", returnFocus = null;
  var groups = { crm: true, documents: false }, scrollState = null, frame = 0;

  function paintIndicator() {
    frame = 0;
    var target = nav.querySelector('.side-link[aria-current="page"]');
    if (target && !target.getClientRects().length) {
      var submenu = target.closest(".sidebar-submenu");
      target = submenu ? panel.querySelector('[aria-controls="' + submenu.id + '"]') : null;
    }
    if (!target || !target.getClientRects().length) { indicator.style.opacity = "0"; return; }
    var bounds = target.getBoundingClientRect(), origin = nav.getBoundingClientRect();
    var inset = bounds.left - origin.left;
    indicator.style.left = inset + "px";
    indicator.style.width = "calc(100% - " + inset + "px)";
    indicator.style.height = bounds.height + "px";
    indicator.style.transform = "translateY(" + (bounds.top - origin.top) + "px)";
    indicator.style.opacity = "1";
  }
  function scheduleIndicator() {
    if (!frame) frame = window.requestAnimationFrame(paintIndicator);
  }
  function sync() {
    var full = media.matches || expanded;
    shell.dataset.sidebarState = expanded ? "expanded" : "collapsed";
    shell.dataset.mobileOpen = String(mobileOpen);
    panel.inert = media.matches && !mobileOpen;
    if (media.matches) panel.setAttribute("aria-hidden", String(!mobileOpen));
    else panel.removeAttribute("aria-hidden");
    if (mobileOpen) { panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true"); }
    else { panel.removeAttribute("role"); panel.removeAttribute("aria-modal"); }
    document.querySelectorAll("[data-sidebar-toggle]").forEach(function(button) {
      button.setAttribute("aria-expanded", String(media.matches ? mobileOpen : expanded));
      button.setAttribute("aria-label", media.matches ? "Abrir navegação" : expanded ? "Recolher navegação" : "Expandir navegação");
    });
    Object.keys(groups).forEach(function(key) {
      var button = panel.querySelector('[data-sidebar-group="' + key + '"]');
      var submenu = document.getElementById(button.getAttribute("aria-controls"));
      submenu.hidden = !(full && groups[key]);
      button.setAttribute("aria-expanded", String(!submenu.hidden));
      button.classList.toggle("is-group-active", !!submenu.querySelector('[aria-current="page"]'));
    });
    scheduleIndicator();
  }
  function lockScroll() {
    var style = document.body.style;
    scrollState = { x: window.scrollX, y: window.scrollY, styles: {} };
    ["position", "top", "left", "right", "width", "overflow", "padding-right"].forEach(function(name) {
      scrollState.styles[name] = [style.getPropertyValue(name), style.getPropertyPriority(name)];
    });
    var gap = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    if (gap) style.setProperty("padding-right", (parseFloat(getComputedStyle(document.body).paddingRight) + gap) + "px");
    style.setProperty("position", "fixed");
    style.setProperty("top", -scrollState.y + "px");
    style.setProperty("left", -scrollState.x + "px");
    style.setProperty("right", "0"); style.setProperty("width", "100%"); style.setProperty("overflow", "hidden");
    scrollState.workspaceInert = workspace.inert;
    workspace.inert = true;
  }
  function unlockScroll() {
    if (!scrollState) return;
    var saved = scrollState;
    scrollState = null;
    Object.keys(saved.styles).forEach(function(name) {
      var value = saved.styles[name];
      if (value[0]) document.body.style.setProperty(name, value[0], value[1]);
      else document.body.style.removeProperty(name);
    });
    workspace.inert = saved.workspaceInert;
    window.scrollTo(saved.x, saved.y);
  }
  function focusables() {
    return Array.from(panel.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]')).filter(function(node) {
      return node.tabIndex >= 0 && node.getClientRects().length && !node.closest("[hidden], [inert]");
    });
  }
  function close(restoreFocus) {
    if (!mobileOpen) return;
    mobileOpen = false;
    unlockScroll(); sync();
    if (restoreFocus !== false && returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
  }
  function toggle() {
    if (!media.matches) {
      // Do not leave keyboard focus in a submenu that is about to disappear.
      if (expanded && document.activeElement.closest(".sidebar-submenu")) shell.querySelector(".sidebar-trigger").focus();
      expanded = !expanded; sync(); return;
    }
    if (mobileOpen) { close(); return; }
    returnFocus = document.activeElement;
    mobileOpen = true; lockScroll(); sync();
    panel.querySelector(".sidebar-close").focus({ preventScroll: true });
  }
  function onClick(event) {
    if (!(event.target instanceof Element)) return;
    var control = event.target.closest("[data-sidebar-toggle], [data-sidebar-close], [data-sidebar-group], [data-sidebar-search]");
    if (control && shell.contains(control)) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (control.hasAttribute("data-sidebar-toggle")) toggle();
      else if (control.hasAttribute("data-sidebar-close")) close();
      else if (control.hasAttribute("data-sidebar-search")) { close(false); document.getElementById("global-search").focus(); }
      else {
        var key = control.dataset.sidebarGroup;
        if (!media.matches && !expanded) { expanded = true; groups[key] = true; }
        else groups[key] = !groups[key];
        sync();
      }
      return;
    }
    if (mobileOpen && panel.contains(event.target) && event.target.closest("[data-view], [data-action], [data-cloud-account], [data-cloud-signout]")) {
      close(false);
      shell.querySelector(".sidebar-trigger").focus({ preventScroll: true });
    }
  }
  function onKey(event) {
    if (document.body.classList.contains("auth-locked") || event.isComposing) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "b") {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat && !document.querySelector(".modal-layer.is-open, .lead-drawer.is-open")) toggle();
      return;
    }
    if (!mobileOpen) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); close(); }
    else if (event.key === "Tab") {
      var items = focusables(), first = items[0], last = items[items.length - 1];
      if (!first) { event.preventDefault(); panel.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    } else if ((event.key === "/" || event.key.toLowerCase() === "n") && !event.ctrlKey && !event.metaKey) {
      // The Hub's global shortcuts must not open another layer behind the mobile drawer.
      event.stopImmediatePropagation();
    }
  }
  function onBreakpoint() { close(); sync(); }
  function setActive(view) {
    panel.querySelectorAll(".side-link[data-view]").forEach(function(button) {
      if (button.dataset.view === view) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    if (currentView !== view) {
      var selected = panel.querySelector('.side-link[aria-current="page"]');
      var submenu = selected && selected.closest(".sidebar-submenu");
      if (submenu) groups[panel.querySelector('[aria-controls="' + submenu.id + '"]').dataset.sidebarGroup] = true;
      currentView = view;
    }
    sync();
  }
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  media.addEventListener("change", onBreakpoint);
  window.addEventListener("resize", scheduleIndicator);
  var observer = typeof ResizeObserver === "function" ? new ResizeObserver(scheduleIndicator) : null;
  if (observer) observer.observe(nav);
  var api = { setActive: setActive, close: close, destroy: function() {
    close(); document.removeEventListener("click", onClick, true); document.removeEventListener("keydown", onKey, true);
    media.removeEventListener("change", onBreakpoint); window.removeEventListener("resize", scheduleIndicator);
    if (observer) observer.disconnect(); if (frame) cancelAnimationFrame(frame); delete panel._micaSidebar;
  } };
  panel._micaSidebar = api; sync();
  return api;
};
