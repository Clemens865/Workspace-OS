/**
 * How an agent asks the workspace (Claude and Codex runs alike). grep cannot see
 * inside .docx/.xlsx/.pptx/.pdf; the app's index can, so the agent searches and
 * reads those through it and cites where it found something.
 */
export const KNOWLEDGE_GUIDANCE =
  'To FIND something in the workspace — including inside Word, Excel, PowerPoint and PDF files, which grep cannot read — run `wos-action run knowledge.search \'{"query":"<your question or key words>"}\'`: it returns the best-matching files with the words around each match and where it is (page, slide, sheet). To READ an office file as text, run `wos-action run knowledge.read \'{"path":"<workspace-relative path>"}\'` (long files come in parts: pass "offset" from the previous answer). Name the file and page/slide/sheet when you use what you found.'
