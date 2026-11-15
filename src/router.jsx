import React, { useEffect, useState } from "react";

const listeners = new Set();

export function navigate(to) {
  if (to === window.location.pathname + window.location.hash) return;
  window.history.pushState(null, "", to);
  listeners.forEach((fn) => fn());
  const hash = to.split("#")[1];
  if (hash) requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView());
  else window.scrollTo(0, 0);
}

export function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    listeners.add(update);
    window.addEventListener("popstate", update);
    return () => { listeners.delete(update); window.removeEventListener("popstate", update); };
  }, []);
  return path;
}

// In-app link: plain <a> so it works with middle-click / open in new tab.
export function Link({ to, children, ...rest }) {
  return (
    <a
      href={to}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
