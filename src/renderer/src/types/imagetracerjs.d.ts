// Ambient types for imagetracerjs (raster → SVG tracer), which ships no types.
// Mirrors the subset we use; see https://github.com/jankovicsandras/imagetracerjs.
declare module 'imagetracerjs' {
  interface ImageTracerOptions {
    ltres?: number
    qtres?: number
    pathomit?: number
    colorsampling?: number
    numberofcolors?: number
    mincolorratio?: number
    colorquantcycles?: number
    scale?: number
    simplifytolerance?: number
    roundcoords?: number
    lcpr?: number
    qcpr?: number
    desc?: boolean
    viewbox?: boolean
    blurradius?: number
    blurdelta?: number
  }

  interface ImageTracer {
    imageToSVG(
      image: string | HTMLImageElement,
      callback: (svgString: string) => void,
      options?: ImageTracerOptions | string,
    ): void
    imagedataToSVG(imagedata: ImageData, options?: ImageTracerOptions | string): string
    imageToTracedata(
      image: string | HTMLImageElement,
      callback: (tracedata: unknown) => void,
      options?: ImageTracerOptions | string,
    ): void
    imagedataToTracedata(imagedata: ImageData, options?: ImageTracerOptions | string): unknown
  }

  const imageTracer: ImageTracer
  export default imageTracer
}
