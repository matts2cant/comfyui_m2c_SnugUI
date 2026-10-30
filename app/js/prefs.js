// The page's own settings in localStorage (keys "snugui.*"). Storage may throw (disabled, some private windows): reads
// then give null and writes are dropped, so the page works without it.
export function pref(key) {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

// a stored JSON value, or null when missing or unreadable
export function prefJSON(key) {
	try {
		return JSON.parse(localStorage.getItem(key));
	} catch {
		return null;
	}
}

export function setPref(key, value) {
	try {
		localStorage.setItem(key, value);
	} catch {}
}
