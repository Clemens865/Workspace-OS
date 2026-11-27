declare module 'mjml' {
  export default function mjml2html(
    source: string,
    options?: { validationLevel?: 'strict' | 'soft' | 'skip'; filePath?: string },
  ): Promise<{ html: string; errors: unknown[] }>
}
