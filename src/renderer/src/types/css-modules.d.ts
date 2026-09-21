declare module '*.module.css' {
  const classes: { readonly [key: string]: string }
  export default classes
}

// Vite's `?worker` import suffix returns a Worker-constructing class.
declare module '*?worker' {
  const workerConstructor: new () => Worker
  export default workerConstructor
}
