// Stands in for `electron` inside the standalone wos-* CLI bundles. The CLIs build
// their own stores; the shared store modules only touch `electron` in code the
// CLIs never run, so an empty object is enough. Bundling this instead of leaving
// `electron` external lets a packaged CLI run where no `electron` package is
// resolvable (a packaged app's resources folder, or the app executable running
// as Node).
module.exports = {}
