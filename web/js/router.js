// Navigo-style hash router: on('/path/:param?', handler), notFound(handler), navigate(path, { replace }), resolve().
export function createRouter() {
    const routes = [];
    let fallback = () => { };
    const router = {
        on(pattern, handler) {
            const names = [];
            const source = pattern.replace(/\/:(\w+)(\?)?/g, (_, name, optional) => {
                names.push(name);
                return optional ? '(?:/([^/]+))?' : '/([^/]+)';
            });
            routes.push({ regex: new RegExp(`^${source}/?$`), names, handler });
            return router;
        },
        notFound(handler) {
            fallback = handler;
            return router;
        },
        navigate(path, { replace = false } = {}) {
            if (replace) history.replaceState(null, '', `#${path}`);
            // Setting the same hash fires no hashchange, so resolve directly then too.
            if (replace || location.hash === `#${path}`) router.resolve();
            else location.hash = path;
        },
        resolve() {
            const path = location.hash.slice(1) || '/';
            for (const route of routes) {
                const match = route.regex.exec(path);
                if (!match) continue;
                try {
                    route.handler({ data: Object.fromEntries(route.names.map((name, index) => [name, match[index + 1] && decodeURIComponent(match[index + 1])])) });
                } catch (error) {
                    if (!(error instanceof URIError)) throw error;
                    fallback();
                }
                return;
            }
            fallback();
        }
    };
    window.addEventListener('hashchange', () => router.resolve());
    return router;
}
