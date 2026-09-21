/**
 * The office menu bar, as data.
 *
 * One table describes every menu item for Writer, Calc and Impress: its label,
 * what it dispatches (a `.uno:` command, or an `office.*` action the renderer
 * owns), an accelerator, whether it is a toggle whose check mark follows the
 * engine, and which apps show it. The native menu bar (menu-office.ts) and
 * the ⌘K palette (menu:office-commands) are both built from it, so the two
 * never drift. Order and grouping follow LibreOffice's own menus, which is
 * what people coming from Office expect to find.
 *
 * Every `.uno:` name here is checked against the engine's command registry by
 * office-menu-table.test.ts — a typo would otherwise dispatch silently.
 */

/** 'w' Writer, 'c' Calc, 'p' Impress; absent = all three. */
export type Apps = string

export interface Entry {
  label: string
  /** A `.uno:` command (dispatched as `office.uno:<cmd>`), possibly with JSON args. */
  uno?: string
  /** A renderer-owned action id (`office.dialog:table`, `edit.cut`, `office.zoom:in`, …). */
  action?: string
  accel?: string
  /** Check mark follows the engine's STATE_CHANGED for `uno`. */
  toggle?: boolean
  apps?: Apps
  sub?: Entry[]
  sep?: true
}

export interface TopMenu {
  label: string
  apps?: Apps
  items: Entry[]
}

const SEP: Entry = { label: '', sep: true }
const u = (label: string, uno: string, extra: Partial<Entry> = {}): Entry => ({ label, uno, ...extra })
const a = (label: string, action: string, extra: Partial<Entry> = {}): Entry => ({ label, action, ...extra })
const t = (label: string, uno: string, extra: Partial<Entry> = {}): Entry => ({ label, uno, toggle: true, ...extra })
const m = (label: string, sub: Entry[], extra: Partial<Entry> = {}): Entry => ({ label, sub, ...extra })

/** `.uno:StyleApply` with JSON args — the dispatchable form of the menu's style aliases. */
export function styleApply(style: string, family: 'ParagraphStyles' | 'CharacterStyles' | 'CellStyles' | 'NumberingStyles'): string {
  return `.uno:StyleApply {"Style":{"type":"string","value":"${style}"},"FamilyName":{"type":"string","value":"${family}"}}`
}
const layout = (label: string, n: number): Entry => u(label, `.uno:AssignLayout {"WhatLayout":{"type":"long","value":${n}}}`, { apps: 'p' })

export const SLIDE_LAYOUT_ENTRIES: Entry[] = [
  layout('Blank Slide', 20), layout('Title Only', 19), layout('Title and Subtitle', 0), layout('Title, Content', 1), layout('Centered Text', 32),
  layout('Two Content', 3), layout('Three Content (1 Left, 2 Right)', 12), layout('Three Content (2 Left, 1 Right)', 15),
  layout('Two Content (1 over 1)', 14), layout('Three Content (2 on Top over 1)', 16), layout('Four Content', 18), layout('Six Content', 34),
]

export const OFFICE_MENU_TABLE: TopMenu[] = [
  {
    label: 'Edit',
    items: [
      u('Undo', '.uno:Undo', { accel: 'CmdOrCtrl+Z' }),
      u('Redo', '.uno:Redo', { accel: 'CmdOrCtrl+Shift+Z' }),
      SEP,
      a('Cut', 'edit.cut', { accel: 'CmdOrCtrl+X' }),
      a('Copy', 'edit.copy', { accel: 'CmdOrCtrl+C' }),
      a('Paste', 'edit.paste', { accel: 'CmdOrCtrl+V' }),
      m('Paste Special', [
        u('Unformatted Text', '.uno:PasteUnformatted', { accel: 'CmdOrCtrl+Alt+Shift+V' }),
        u('Text Only', '.uno:PasteOnlyText', { apps: 'c' }),
        u('Numbers Only', '.uno:PasteOnlyValue', { apps: 'c' }),
        u('Formulas Only', '.uno:PasteOnlyFormula', { apps: 'c' }),
        u('Transposed', '.uno:PasteTransposed', { apps: 'c' }),
        SEP,
        u('Paste Special…', '.uno:PasteSpecial'),
      ]),
      a('Select All', 'edit.selectAll', { accel: 'CmdOrCtrl+A' }),
      m('Select', [
        u('Row', '.uno:SelectRow'), u('Column', '.uno:SelectColumn'), u('Data Area', '.uno:SelectData'),
        u('Visible Rows Only', '.uno:SelectVisibleRows'), u('Visible Columns Only', '.uno:SelectVisibleColumns'),
      ], { apps: 'c' }),
      SEP,
      u('Find & Replace…', '.uno:SearchDialog', { accel: 'CmdOrCtrl+F' }),
      u('Go to Page…', '.uno:GotoPage', { apps: 'w' }),
      SEP,
      m('Track Changes', [
        t('Record', '.uno:TrackChanges'), t('Show', '.uno:ShowTrackedChanges'), u('Manage…', '.uno:AcceptTrackedChanges'),
        SEP,
        u('Accept', '.uno:AcceptTrackedChange'), u('Reject', '.uno:RejectTrackedChange'),
        u('Next', '.uno:NextTrackedChange'), u('Previous', '.uno:PreviousTrackedChange'),
        u('Accept All', '.uno:AcceptAllTrackedChanges'), u('Reject All', '.uno:RejectAllTrackedChanges'),
        u('Comment…', '.uno:CommentChangeTracking'),
      ], { apps: 'w' }),
      m('Track Changes', [
        t('Record', '.uno:TraceChangeMode'), u('Show…', '.uno:ShowChanges'), u('Manage…', '.uno:AcceptChanges'), u('Comment…', '.uno:CommentChange'),
      ], { apps: 'c' }),
      SEP,
      a('Find in Files…', 'go.searchpanel', { accel: 'Shift+CmdOrCtrl+F' }),
    ],
  },
  {
    label: 'View',
    items: [
    a('Ruler', 'office.ruler', { apps: 'w' }), a('Print Preview', 'office.view:preview', { apps: 'w' }),
    a('Slide Sorter', 'office.view:sorter', { apps: 'p' }), a('Outline', 'office.view:outline', { apps: 'p' }),
    SEP,
      a('Zoom In', 'office.zoom:in', { accel: 'CmdOrCtrl+Plus' }),
      a('Zoom Out', 'office.zoom:out', { accel: 'CmdOrCtrl+-' }),
      a('Actual Size', 'office.zoom:reset', { accel: 'CmdOrCtrl+0' }),
      SEP,
      u('Normal', '.uno:PrintLayout', { apps: 'w' }),
      u('Web', '.uno:BrowseView', { apps: 'w' }),
      u('Normal', '.uno:NormalViewMode', { apps: 'c' }),
      u('Page Break', '.uno:PagebreakMode', { apps: 'c' }),
      t('Normal', '.uno:NormalMultiPaneGUI', { apps: 'p' }),
      t('Notes', '.uno:NotesMode', { apps: 'p' }),
      t('Master Slide', '.uno:SlideMasterPage', { apps: 'p' }),
      SEP,
      t('Formatting Marks', '.uno:ControlCodes', { apps: 'w' }),
      t('Text Boundaries', '.uno:ShowBoundaries', { apps: 'w' }),
      t('Whitespace', '.uno:ShowWhitespace', { apps: 'w' }),
      t('Field Shadings', '.uno:Marks', { apps: 'w' }),
      t('Field Names', '.uno:Fieldnames', { apps: 'w' }),
      t('Show Tracked Changes', '.uno:ShowTrackedChanges', { apps: 'w' }),
      t('Comments', '.uno:ShowAnnotations', { apps: 'wc' }),
      t('Formula Bar', '.uno:InputLineVisible', { apps: 'c' }),
      t('Column/Row Headings', '.uno:ViewRowColumnHeaders', { apps: 'c' }),
      t('Gridlines', '.uno:ToggleSheetGrid', { apps: 'c' }),
      t('Value Highlighting', '.uno:ViewValueHighlighting', { apps: 'c' }),
      t('Show Formulas', '.uno:ToggleFormula', { apps: 'c' }),
      SEP,
      t('Freeze Rows and Columns', '.uno:FreezePanes', { apps: 'c' }),
      u('Freeze First Row', '.uno:FreezePanesRow', { apps: 'c' }),
      u('Freeze First Column', '.uno:FreezePanesColumn', { apps: 'c' }),
      t('Split Window', '.uno:SplitWindow', { apps: 'c' }),
      t('Display Grid', '.uno:GridVisible', { apps: 'p' }),
      t('Snap to Grid', '.uno:GridUse', { apps: 'p' }),
      t('Comments', '.uno:ShowAnnotations', { apps: 'p' }),
      a('Components Panel', 'office.components', { apps: 'p' }),
    ],
  },
  {
    label: 'Insert',
    items: [
      u('Page Break', '.uno:InsertPagebreak', { apps: 'w' }),
      m('More Breaks', [u('Column Break', '.uno:InsertColumnBreak'), u('Manual Break…', '.uno:InsertBreak')], { apps: 'w' }),
      a('Image…', 'office.image'),
      u('Chart…', '.uno:InsertObjectChart', { apps: 'wp' }),
      m('Chart (from selection)', [
        a('Column', 'office.chart:column'), a('Bar', 'office.chart:bar'), a('Line', 'office.chart:line'), a('Pie', 'office.chart:pie'), a('Area', 'office.chart:area'),
      ], { apps: 'c' }),
      u('Sparkline…', '.uno:InsertSparkline', { apps: 'c' }),
      u('Pivot Table…', '.uno:DataDataPilotRun', { apps: 'c' }),
      a('Table…', 'office.dialog:table'),
      m('Shape', [
        a('Rectangle', 'office.shape:rect'), a('Rounded Rectangle', 'office.shape:roundrect'), a('Ellipse', 'office.shape:ellipse'),
        a('Line', 'office.shape:line'), a('Arrow', 'office.shape:arrow'), a('Text Box', 'office.shape:text'),
      ], { apps: 'p' }),
      u('Text Box', '.uno:DrawText', { apps: 'wc' }),
      u('Comment', '.uno:InsertAnnotation', { accel: 'Alt+CmdOrCtrl+C' }),
      u('Section…', '.uno:InsertSection', { apps: 'w' }),
      u('Frame…', '.uno:InsertFrame', { apps: 'w' }),
      u('Caption…', '.uno:InsertCaptionDialog', { apps: 'w' }),
      SEP,
      a('Hyperlink…', 'office.dialog:hyperlink'),
      u('Bookmark…', '.uno:InsertBookmark', { apps: 'w' }),
      u('Cross-reference…', '.uno:InsertReferenceField', { apps: 'w' }),
      a('Special Character…', 'office.dialog:symbol'),
      m('Formatting Mark', [
        u('No-break Space', '.uno:InsertNonBreakingSpace'), u('Non-breaking Hyphen', '.uno:InsertHardHyphen'),
        u('Soft Hyphen', '.uno:InsertSoftHyphen'), u('Zero-width Space', '.uno:InsertZWSP'),
      ]),
      u('QR and Barcode…', '.uno:InsertQrCode'),
      SEP,
      m('Footnote and Endnote', [
        u('Footnote', '.uno:InsertFootnote'), u('Endnote', '.uno:InsertEndnote'), u('Footnote or Endnote…', '.uno:InsertFootnoteDialog'),
      ], { apps: 'w' }),
      m('Table of Contents and Index', [
        u('Table of Contents, Index or Bibliography…', '.uno:InsertMultiIndex'), u('Index Entry…', '.uno:InsertIndexesEntry'), u('Citation…', '.uno:InsertAuthoritiesEntry'),
      ], { apps: 'w' }),
      m('Field', [
        u('Page Number', '.uno:InsertPageNumberField'), u('Page Count', '.uno:InsertPageCountField'),
        u('Date', '.uno:InsertDateField'), u('Time', '.uno:InsertTimeField'), u('Title', '.uno:InsertTitleField'), u('Author', '.uno:InsertAuthorField'),
        SEP, u('More Fields…', '.uno:InsertFieldCtrl'),
      ], { apps: 'w' }),
      m('Header and Footer', [u('Header', '.uno:InsertPageHeader'), u('Footer', '.uno:InsertPageFooter')], { apps: 'w' }),
      u('Function…', '.uno:FunctionDialog', { apps: 'c' }),
      u('Named Range or Expression…', '.uno:InsertName', { apps: 'c' }),
      u('Date', '.uno:InsertCurrentDate', { apps: 'c' }),
      u('Time', '.uno:InsertCurrentTime', { apps: 'c' }),
      m('Field', [u('Date', '.uno:InsertFieldDateVariable'), u('Sheet Name', '.uno:InsertFieldSheet'), u('Document Title', '.uno:InsertFieldDocTitle')], { apps: 'c' }),
      u('Headers and Footers…', '.uno:EditHeaderAndFooter', { apps: 'c' }),
      m('Slide', [
        a('New Slide', 'office.slide:.uno:InsertPage'), a('Duplicate Slide', 'office.slide:.uno:DuplicatePage'), a('Delete Slide', 'office.slide:.uno:DeletePage'),
      ], { apps: 'p' }),
      u('Slide Number', '.uno:InsertSlideField', { apps: 'p' }),
      m('Field', [
        u('Date (fixed)', '.uno:InsertDateFieldFix'), u('Date (variable)', '.uno:InsertDateFieldVar'),
        u('Time (fixed)', '.uno:InsertTimeFieldFix'), u('Time (variable)', '.uno:InsertTimeFieldVar'),
        u('Author', '.uno:InsertAuthorField'), u('Slide Title', '.uno:InsertSlideTitleField'), u('Slide Count', '.uno:InsertSlidesField'), u('File Name', '.uno:InsertFileField'),
      ], { apps: 'p' }),
      u('Header and Footer…', '.uno:HeaderAndFooter', { apps: 'p' }),
      m('Table of Contents and Index', [a('Table of Contents', 'office.toc:insert'), u('Table of Contents, Index or Bibliography…', '.uno:InsertMultiIndex'), a('Update All', 'office.toc:update')], { apps: 'w' }),
      m('Watermark', [a('Draft', 'office.watermark:DRAFT'), a('Confidential', 'office.watermark:CONFIDENTIAL'), a('Remove', 'office.watermark:'), u('Custom…', '.uno:Watermark')], { apps: 'w' }),
    ],
  },
]

const TEXT_FORMAT: Entry = m('Text', [
  t('Bold', '.uno:Bold', { accel: 'CmdOrCtrl+B' }),
  t('Italic', '.uno:Italic', { accel: 'CmdOrCtrl+I' }),
  t('Underline', '.uno:Underline', { accel: 'CmdOrCtrl+U' }),
  u('Double Underline', '.uno:UnderlineDouble'),
  t('Strikethrough', '.uno:Strikeout'),
  u('Overline', '.uno:Overline'),
  t('Superscript', '.uno:SuperScript'),
  t('Subscript', '.uno:SubScript'),
  t('Shadow', '.uno:Shadowed'),
  t('Outline', '.uno:OutlineFont'),
  u('Small Capitals', '.uno:SmallCaps', { apps: 'w' }),
  SEP,
  u('Increase Size', '.uno:Grow', { accel: 'CmdOrCtrl+]' }),
  u('Decrease Size', '.uno:Shrink', { accel: 'CmdOrCtrl+[' }),
  SEP,
  u('UPPERCASE', '.uno:ChangeCaseToUpper'),
  u('lowercase', '.uno:ChangeCaseToLower'),
  u('Sentence case', '.uno:ChangeCaseToSentenceCase'),
  u('Capitalize Every Word', '.uno:ChangeCaseToTitleCase'),
  u('tOGGLE cASE', '.uno:ChangeCaseToToggleCase'),
  u('Cycle Case', '.uno:ChangeCaseRotateCase'),
])

const OBJECT_FORMAT: Entry[] = [
  m('Text Box and Shape', [
    u('Position and Size…', '.uno:TransformDialog'), u('Line…', '.uno:FormatLine'), u('Area…', '.uno:FormatArea'), u('Text Attributes…', '.uno:TextAttributes'),
  ]),
  m('Image', [
    u('Crop', '.uno:Crop'), u('Original Size', '.uno:OriginalSize', { apps: 'cp' }), u('Compress…', '.uno:CompressGraphic'), u('Properties…', '.uno:GraphicDialog', { apps: 'w' }),
  ]),
  m('Anchor', [
    u('To Page', '.uno:SetAnchorToPage'), u('To Paragraph', '.uno:SetAnchorToPara'), u('To Character', '.uno:SetAnchorToChar'), u('As Character', '.uno:SetAnchorAtChar'),
  ], { apps: 'w' }),
  m('Wrap', [
    u('None', '.uno:WrapOff'), u('Parallel', '.uno:WrapOn'), u('Optimal', '.uno:WrapIdeal'), u('Before', '.uno:WrapLeft'), u('After', '.uno:WrapRight'),
    u('Through', '.uno:WrapThrough'), u('Contour', '.uno:WrapContour'), u('First Paragraph', '.uno:WrapAnchorOnly'),
  ], { apps: 'w' }),
  m('Arrange', [
    u('Bring to Front', '.uno:BringToFront'), u('Forward One', '.uno:ObjectForwardOne', { apps: 'wc' }), u('Forward One', '.uno:Forward', { apps: 'p' }),
    u('Back One', '.uno:ObjectBackOne', { apps: 'wc' }), u('Back One', '.uno:Backward', { apps: 'p' }), u('Send to Back', '.uno:SendToBack'),
  ]),
  m('Rotate or Flip', [
    u('Rotate 90° Left', '.uno:RotateLeft'), u('Rotate 90° Right', '.uno:RotateRight'), u('Rotate 180°', '.uno:Rotate180'),
    u('Flip Vertically', '.uno:FlipVertical'), u('Flip Horizontally', '.uno:FlipHorizontal'),
  ], { apps: 'w' }),
  m('Flip', [u('Vertically', '.uno:ObjectMirrorVertical'), u('Horizontally', '.uno:ObjectMirrorHorizontal')], { apps: 'c' }),
  m('Flip', [u('Vertically', '.uno:MirrorVert'), u('Horizontally', '.uno:MirrorHorz')], { apps: 'p' }),
  m('Group', [u('Group', '.uno:FormatGroup', { accel: 'CmdOrCtrl+G' }), u('Ungroup', '.uno:FormatUngroup', { accel: 'CmdOrCtrl+Shift+G' }), u('Enter Group', '.uno:EnterGroup'), u('Exit Group', '.uno:LeaveGroup')]),
  u('Name…', '.uno:NameGroup', { apps: 'wp' }),
  u('Alt Text…', '.uno:ObjectTitleDescription'),
]

OFFICE_MENU_TABLE.push({
  label: 'Format',
  items: [
    TEXT_FORMAT,
    m('Spacing', [
      t('Line Spacing: 1', '.uno:SpacePara1'), t('Line Spacing: 1.15', '.uno:SpacePara115', { apps: 'w' }), t('Line Spacing: 1.5', '.uno:SpacePara15'), t('Line Spacing: 2', '.uno:SpacePara2'),
      SEP, u('Increase Paragraph Spacing', '.uno:ParaspaceIncrease'), u('Decrease Paragraph Spacing', '.uno:ParaspaceDecrease'),
      SEP, u('Increase Indent', '.uno:IncrementIndent'), u('Decrease Indent', '.uno:DecrementIndent'),
    ], { apps: 'wp' }),
    m('Align Text', [
      t('Left', '.uno:LeftPara', { apps: 'wp' }), t('Centered', '.uno:CenterPara', { apps: 'wp' }), t('Right', '.uno:RightPara', { apps: 'wp' }), t('Justified', '.uno:JustifyPara', { apps: 'wp' }),
      t('Left', '.uno:AlignLeft', { apps: 'c' }), t('Centered', '.uno:AlignHorizontalCenter', { apps: 'c' }), t('Right', '.uno:AlignRight', { apps: 'c' }),
      SEP, t('Top', '.uno:AlignTop', { apps: 'c' }), t('Middle', '.uno:AlignVCenter', { apps: 'c' }), t('Bottom', '.uno:AlignBottom', { apps: 'c' }),
    ]),
    m('Lists', [
      t('Unordered List', '.uno:DefaultBullet'), t('Ordered List', '.uno:DefaultNumbering'), u('No List', '.uno:RemoveBullets', { apps: 'w' }),
      SEP,
      u('Promote Outline Level', '.uno:IncrementLevel', { apps: 'w' }), u('Demote Outline Level', '.uno:DecrementLevel', { apps: 'w' }),
      u('Move Item Up', '.uno:MoveUp', { apps: 'w' }), u('Move Item Down', '.uno:MoveDown', { apps: 'w' }), u('Restart Numbering', '.uno:NumberingStart', { apps: 'w' }),
      u('Promote', '.uno:OutlineLeft', { apps: 'p' }), u('Demote', '.uno:OutlineRight', { apps: 'p' }), u('Move Up', '.uno:OutlineUp', { apps: 'p' }), u('Move Down', '.uno:OutlineDown', { apps: 'p' }),
      SEP, u('Bullets and Numbering…', '.uno:OutlineBullet'),
    ], { apps: 'wp' }),
    m('Number Format', [
      u('General', '.uno:NumberFormatStandard'), t('Number', '.uno:NumberFormatDecimal'), t('Percent', '.uno:NumberFormatPercent'), t('Currency', '.uno:NumberFormatCurrency'),
      t('Date', '.uno:NumberFormatDate'), u('Time', '.uno:NumberFormatTime'), u('Scientific', '.uno:NumberFormatScientific'), u('Thousands Separator', '.uno:NumberFormatThousands'),
      SEP, u('Add Decimal Place', '.uno:NumberFormatIncDecimals'), u('Delete Decimal Place', '.uno:NumberFormatDecDecimals'),
    ], { apps: 'c' }),
    SEP,
    t('Clone Formatting', '.uno:FormatPaintbrush'),
    u('Clear Direct Formatting', '.uno:ResetAttributes'),
    SEP,
    u('Character…', '.uno:FontDialog'),
    u('Paragraph…', '.uno:ParagraphDialog'),
    a('Cells…', 'office.dialog:formatcells', { apps: 'c' }),
    m('Row', [u('Height…', '.uno:RowHeight'), u('Optimal Height…', '.uno:SetOptimalRowHeight'), u('Hide', '.uno:HideRow'), u('Show', '.uno:ShowRow')], { apps: 'c' }),
    m('Column', [u('Width…', '.uno:ColumnWidth'), u('Optimal Width…', '.uno:SetOptimalColumnWidth'), u('Hide', '.uno:HideColumn'), u('Show', '.uno:ShowColumn')], { apps: 'c' }),
    m('Merge and Unmerge Cells', [t('Merge and Center Cells', '.uno:ToggleMergeCells'), u('Merge Cells', '.uno:MergeCells'), u('Unmerge Cells', '.uno:SplitCell')], { apps: 'c' }),
    t('Wrap Text', '.uno:WrapText', { apps: 'c' }),
    m('Conditional', [
      u('Condition…', '.uno:ConditionalFormatDialog'), u('Color Scale…', '.uno:ColorScaleFormatDialog'), u('Data Bar…', '.uno:DataBarFormatDialog'),
      u('Icon Set…', '.uno:IconSetFormatDialog'), SEP, u('Manage…', '.uno:ConditionalFormatManagerDialog'),
    ], { apps: 'c' }),
    u('AutoFormat Styles…', '.uno:AutoFormat', { apps: 'c' }),
    u('Page Style…', '.uno:PageDialog', { apps: 'w' }),
    u('Page Style…', '.uno:PageFormatDialog', { apps: 'c' }),
    u('Columns…', '.uno:FormatColumns', { apps: 'w' }),
    u('Watermark…', '.uno:Watermark', { apps: 'w' }),
    u('Sections…', '.uno:EditRegion', { apps: 'w' }),
    u('Slide Properties…', '.uno:SlideSetup', { apps: 'p' }),
    SEP,
    ...OBJECT_FORMAT,
  ],
})

OFFICE_MENU_TABLE.push({
  label: 'Styles',
  items: [
    u('Body Text', styleApply('Text Body', 'ParagraphStyles'), { apps: 'w' }),
    u('Title', styleApply('Title', 'ParagraphStyles'), { apps: 'w' }),
    u('Subtitle', styleApply('Subtitle', 'ParagraphStyles'), { apps: 'w' }),
    u('Heading 1', styleApply('Heading 1', 'ParagraphStyles'), { apps: 'w', accel: 'CmdOrCtrl+1' }),
    u('Heading 2', styleApply('Heading 2', 'ParagraphStyles'), { apps: 'w', accel: 'CmdOrCtrl+2' }),
    u('Heading 3', styleApply('Heading 3', 'ParagraphStyles'), { apps: 'w', accel: 'CmdOrCtrl+3' }),
    u('Heading 4', styleApply('Heading 4', 'ParagraphStyles'), { apps: 'w' }),
    u('Block Quotation', styleApply('Quotations', 'ParagraphStyles'), { apps: 'w' }),
    u('Preformatted Text', styleApply('Preformatted Text', 'ParagraphStyles'), { apps: 'w' }),
    SEP,
    u('No Character Style', styleApply('Standard', 'CharacterStyles'), { apps: 'w' }),
    u('Emphasis', styleApply('Emphasis', 'CharacterStyles'), { apps: 'w' }),
    u('Strong Emphasis', styleApply('Strong Emphasis', 'CharacterStyles'), { apps: 'w' }),
    u('Quotation', styleApply('Citation', 'CharacterStyles'), { apps: 'w' }),
    u('Source Text', styleApply('Source Text', 'CharacterStyles'), { apps: 'w' }),
    SEP,
    u('No List', '.uno:RemoveBullets', { apps: 'w' }),
    u('Bullet • List Style', styleApply('List 1', 'NumberingStyles'), { apps: 'w' }),
    u('Numbering 123 List Style', styleApply('Numbering 123', 'NumberingStyles'), { apps: 'w' }),
    u('Numbering ABC List Style', styleApply('Numbering ABC', 'NumberingStyles'), { apps: 'w' }),
    u('Numbering abc List Style', styleApply('Numbering abc', 'NumberingStyles'), { apps: 'w' }),
    u('Numbering IVX List Style', styleApply('Numbering IVX', 'NumberingStyles'), { apps: 'w' }),
    u('Default', styleApply('Default', 'CellStyles'), { apps: 'c' }),
    u('Accent 1', styleApply('Accent 1', 'CellStyles'), { apps: 'c' }),
    u('Accent 2', styleApply('Accent 2', 'CellStyles'), { apps: 'c' }),
    u('Accent 3', styleApply('Accent 3', 'CellStyles'), { apps: 'c' }),
    u('Heading 1', styleApply('Heading 1', 'CellStyles'), { apps: 'c' }),
    u('Heading 2', styleApply('Heading 2', 'CellStyles'), { apps: 'c' }),
    u('Good', styleApply('Good', 'CellStyles'), { apps: 'c' }),
    u('Bad', styleApply('Bad', 'CellStyles'), { apps: 'c' }),
    u('Neutral', styleApply('Neutral', 'CellStyles'), { apps: 'c' }),
    u('Error', styleApply('Error', 'CellStyles'), { apps: 'c' }),
    u('Warning', styleApply('Warning', 'CellStyles'), { apps: 'c' }),
    u('Footnote', styleApply('Footnote', 'CellStyles'), { apps: 'c' }),
    u('Note', styleApply('Note', 'CellStyles'), { apps: 'c' }),
    SEP,
    u('Edit Style…', '.uno:EditStyle'),
    u('Update Selected Style', '.uno:StyleUpdateByExample'),
    u('New Style from Selection…', '.uno:StyleNewByExample'),
  ],
})

OFFICE_MENU_TABLE.push({
  label: 'Table',
  apps: 'w',
  items: [
    a('Insert Table…', 'office.dialog:table', { accel: 'CmdOrCtrl+F12' }),
    m('Insert', [
      u('Rows Above', '.uno:InsertRowsBefore'), u('Rows Below', '.uno:InsertRowsAfter'), u('Rows…', '.uno:InsertRowDialog'),
      SEP, u('Columns Before', '.uno:InsertColumnsBefore'), u('Columns After', '.uno:InsertColumnsAfter'), u('Columns…', '.uno:InsertColumnDialog'),
    ]),
    m('Delete', [u('Rows', '.uno:DeleteRows'), u('Columns', '.uno:DeleteColumns'), u('Table', '.uno:DeleteTable')]),
    m('Select', [u('Cell', '.uno:EntireCell'), u('Row', '.uno:EntireRow'), u('Column', '.uno:EntireColumn'), u('Table', '.uno:SelectTable')]),
    m('Size', [
      u('Row Height…', '.uno:SetRowHeight'), u('Minimal Row Height', '.uno:SetMinimalRowHeight'), u('Optimal Row Height', '.uno:SetOptimalRowHeight'), u('Distribute Rows Evenly', '.uno:DistributeRows'),
      SEP, u('Column Width…', '.uno:SetColumnWidth'), u('Minimal Column Width', '.uno:SetMinimalColumnWidth'), u('Optimal Column Width', '.uno:SetOptimalColumnWidth'), u('Distribute Columns Evenly', '.uno:DistributeColumns'),
    ]),
    SEP,
    u('Merge Cells', '.uno:MergeCells'), u('Split Cells…', '.uno:SplitCell'), u('Merge Table', '.uno:MergeTable'), u('Split Table…', '.uno:SplitTable'),
    SEP,
    u('AutoFormat Styles…', '.uno:AutoFormat'), u('Number Format…', '.uno:TableNumberFormatDialog'),
    t('Number Recognition', '.uno:TableNumberRecognition'), t('Header Rows Repeat Across Pages', '.uno:HeadingRowsRepeat'), t('Row to Break Across Pages', '.uno:RowSplit'),
    m('Convert', [u('Text to Table…', '.uno:ConvertTextToTable'), u('Table to Text…', '.uno:ConvertTableToText')]),
    u('Sort…', '.uno:TableSort'),
    u('Properties…', '.uno:TableDialog'),
  ],
})

OFFICE_MENU_TABLE.push({
  label: 'Sheet',
  apps: 'c',
  items: [
    u('Insert Cells…', '.uno:InsertCell'),
    m('Insert Rows', [u('Rows Above', '.uno:InsertRowsBefore'), u('Rows Below', '.uno:InsertRowsAfter')]),
    m('Insert Columns', [u('Columns Before', '.uno:InsertColumnsBefore'), u('Columns After', '.uno:InsertColumnsAfter')]),
    m('Insert Page Break', [u('Row Break', '.uno:InsertRowBreak'), u('Column Break', '.uno:InsertColumnBreak')]),
    u('Delete Cells…', '.uno:DeleteCell'), u('Delete Rows', '.uno:DeleteRows'), u('Delete Columns', '.uno:DeleteColumns'),
    m('Delete Page Break', [u('Row Break', '.uno:DeleteRowbreak'), u('Column Break', '.uno:DeleteColumnbreak')]),
    SEP,
    u('Insert Sheet…', '.uno:Insert'), u('Insert Sheet at End…', '.uno:Add'), u('Delete Sheet…', '.uno:Remove'), u('Rename Sheet…', '.uno:RenameTable'),
    u('Hide Sheet', '.uno:Hide'), u('Show Sheet…', '.uno:Show'), u('Move or Copy Sheet…', '.uno:Move'), u('Duplicate Sheet', '.uno:DuplicateSheet'), u('Sheet Tab Color…', '.uno:SetTabBgColor'),
    SEP,
    u('Clear Cells…', '.uno:Delete'),
    m('Fill Cells', [
      u('Fill Down', '.uno:FillDown', { accel: 'CmdOrCtrl+D' }), u('Fill Right', '.uno:FillRight', { accel: 'CmdOrCtrl+R' }), u('Fill Up', '.uno:FillUp'), u('Fill Left', '.uno:FillLeft'),
      SEP, u('Fill Series…', '.uno:FillSeries'), u('Fill Random Number…', '.uno:RandomNumberGeneratorDialog'),
    ]),
    m('Named Ranges and Expressions', [u('Define…', '.uno:AddName'), u('Manage…', '.uno:DefineName'), u('Insert…', '.uno:SheetInsertName'), u('Create…', '.uno:CreateNames')]),
    m('Cell Comments', [u('Edit Comment', '.uno:EditAnnotation'), u('Hide Comment', '.uno:HideNote'), u('Show Comment', '.uno:ShowNote'), u('Delete Comment', '.uno:DeleteNote'), u('Delete All Comments', '.uno:DeleteAllNotes')]),
    u('Cycle Cell Reference Types', '.uno:ToggleRelative'),
    m('Navigate', [u('To Previous Sheet', '.uno:JumpToPrevTable'), u('To Next Sheet', '.uno:JumpToNextTable')]),
  ],
})

OFFICE_MENU_TABLE.push({
  label: 'Data',
  apps: 'c',
  items: [
    m('Group and Outline', [
      a('Group', 'office.outline:group'), a('Ungroup', 'office.outline:ungroup'), SEP,
      a('AutoOutline', 'office.outline:auto'), a('Remove Outline', 'office.outline:clear'), SEP,
      a('Hide Details', 'office.outline:hide'), a('Show Details', 'office.outline:show'),
    ]),
    SEP,
    u('Sort…', '.uno:DataSort'), a('Sort Ascending', 'office.sort:asc'), a('Sort Descending', 'office.sort:desc'),
    SEP,
    t('AutoFilter', '.uno:DataFilterAutoFilter'),
    m('More Filters', [
      u('Standard Filter…', '.uno:DataFilterStandardFilter'), u('Advanced Filter…', '.uno:DataFilterSpecialFilter'),
      u('Reset Filter', '.uno:DataFilterRemoveFilter'), u('Hide AutoFilter', '.uno:DataFilterHideAutoFilter'),
    ]),
    u('Duplicates…', '.uno:HandleDuplicateRecords'),
    SEP,
    u('Define Range…', '.uno:DefineDBName'), u('Select Range…', '.uno:SelectDB'), u('Refresh Range', '.uno:DataAreaRefresh'),
    m('Pivot Table', [u('Insert or Edit…', '.uno:InsertPivotTable'), u('Refresh', '.uno:RecalcPivotTable'), u('Delete', '.uno:DeletePivotTable')]),
    SEP,
    m('Calculate', [u('Recalculate', '.uno:Calculate', { accel: 'F9' }), u('Recalculate Hard', '.uno:CalculateHard'), u('Formula to Value', '.uno:ConvertFormulaToValue'), t('AutoCalculate', '.uno:AutomaticCalculation')]),
    a('Validity…', 'office.dialog:datavalidation'),
    u('Subtotals…', '.uno:DataSubTotals'), u('Text to Columns…', '.uno:TextToColumns'), u('Consolidate…', '.uno:DataConsolidate'),
    m('Group and Outline', [
      u('Group…', '.uno:Group'), u('Ungroup…', '.uno:Ungroup'), u('AutoOutline', '.uno:AutoOutline'), u('Remove Outline', '.uno:ClearOutline'),
      u('Hide Details', '.uno:HideDetail'), u('Show Details', '.uno:ShowDetail'),
    ]),
    m('Statistics', [
      u('Sampling…', '.uno:SamplingDialog'), u('Descriptive Statistics…', '.uno:DescriptiveStatisticsDialog'), u('Analysis of Variance (ANOVA)…', '.uno:AnalysisOfVarianceDialog'),
      u('Correlation…', '.uno:CorrelationDialog'), u('Covariance…', '.uno:CovarianceDialog'), u('Moving Average…', '.uno:MovingAverageDialog'), u('Regression…', '.uno:RegressionDialog'),
    ]),
    u('Goal Seek…', '.uno:GoalSeekDialog'), u('Solver…', '.uno:SolverDialog'), u('Scenarios…', '.uno:ScenarioManager'),
    m('Detective', [
      u('Trace Precedents', '.uno:ShowPrecedents'), u('Trace Dependents', '.uno:ShowDependents'), u('Remove Precedents', '.uno:ClearArrowPrecedents'),
      u('Remove Dependents', '.uno:ClearArrowDependents'), u('Remove All Traces', '.uno:ClearArrows'), u('Trace Error', '.uno:ShowErrors'), u('Mark Invalid Data', '.uno:ShowInvalid'),
    ]),
  ],
})

OFFICE_MENU_TABLE.push({
  label: 'Slide',
  apps: 'p',
  items: [
    a('New Slide', 'office.slide:.uno:InsertPage', { accel: 'CmdOrCtrl+M' }), a('Duplicate Slide', 'office.slide:.uno:DuplicatePage'), a('Delete Slide', 'office.slide:.uno:DeletePage'),
    u('Rename Slide…', '.uno:RenameSlide'), u('Hide Slide', '.uno:HideSlide'), u('Show Slide', '.uno:ShowSlide'),
    SEP,
    m('Layout', SLIDE_LAYOUT_ENTRIES),
    u('Slide Properties…', '.uno:SlideSetup'), u('Change Slide Master…', '.uno:PresentationLayout'), u('Master Elements…', '.uno:MasterLayouts'),
    SEP,
    a('Slide Transition…', 'office.transitions'), a('Custom Animation…', 'office.animations'),
    SEP,
    m('Move', [u('Slide to Start', '.uno:MoveSlideFirst'), u('Slide Up', '.uno:MoveSlideUp'), u('Slide Down', '.uno:MoveSlideDown'), u('Slide to End', '.uno:MoveSlideLast')]),
    m('Navigate', [u('To First Slide', '.uno:FirstSlide'), u('To Previous Slide', '.uno:PreviousSlide'), u('To Next Slide', '.uno:NextSlide'), u('To Last Slide', '.uno:LastSlide')]),
    u('Summary Slide', '.uno:SummaryPage'), u('Expand Slide', '.uno:ExpandPage'),
  ],
})

OFFICE_MENU_TABLE.push({
  label: 'Slide Show',
  apps: 'p',
  items: [
    a('Start from First Slide', 'office.present:first', { accel: 'Alt+CmdOrCtrl+Return' }),
    a('Start from Current Slide', 'office.present:current', { accel: 'Shift+CmdOrCtrl+Return' }),
    SEP,
    u('Custom Slide Show…', '.uno:CustomShowDialog'), u('Slide Show Settings…', '.uno:PresentationDialog'),
  ],
})

OFFICE_MENU_TABLE.push({
  label: 'Tools',
  items: [
    u('Spelling…', '.uno:SpellingAndGrammarDialog', { apps: 'w', accel: 'F7' }),
    u('Spelling…', '.uno:SpellDialog', { apps: 'cp', accel: 'F7' }),
    t('Automatic Spell Checking', '.uno:SpellOnline'),
    u('Thesaurus…', '.uno:ThesaurusDialog'),
    u('Hyphenation…', '.uno:Hyphenate', { apps: 'wc' }),
    u('Word Count…', '.uno:WordCountDialog', { apps: 'w' }),
    SEP,
    m('AutoCorrect', [t('While Typing', '.uno:OnlineAutoFormat', { apps: 'w' }), u('Apply', '.uno:AutoFormatApply', { apps: 'w' }), u('AutoCorrect Options…', '.uno:AutoCorrectDlg')]),
    t('AutoInput', '.uno:AutoComplete', { apps: 'c' }),
    m('Update', [
      u('Update All', '.uno:UpdateAll'), u('Fields', '.uno:UpdateFields'), u('Indexes and Tables', '.uno:UpdateAllIndexes'),
      u('Links', '.uno:UpdateAllLinks'), u('Charts', '.uno:UpdateCharts'), u('Page Formatting', '.uno:Repaginate'),
    ], { apps: 'w' }),
    u('Heading Numbering…', '.uno:ChapterNumberingDialog', { apps: 'w' }),
    u('Line Numbering…', '.uno:LineNumberingDialog', { apps: 'w' }),
    u('Footnote and Endnote Settings…', '.uno:FootnoteDialog', { apps: 'w' }),
    m('Protect Document', [t('Protect Fields', '.uno:ProtectFields'), t('Protect Bookmarks', '.uno:ProtectBookmarks')], { apps: 'w' }),
    u('Sort…', '.uno:SortDialog', { apps: 'w' }),
    u('Protect Sheet…', '.uno:Protect', { apps: 'c' }),
    u('Protect Spreadsheet Structure…', '.uno:ToolProtectionDocument', { apps: 'c' }),
  ],
})

// ── Builders ──────────────────────────────────────────────────────────────

export const APP_CODE: Record<number, string> = { 0: 'w', 1: 'c', 2: 'p' }

export function forApp(entry: { apps?: Apps }, code: string): boolean {
  return !entry.apps || entry.apps.includes(code)
}

/** The dispatch id the renderer understands for an entry. */
export function actionIdFor(e: Entry): string | null {
  if (e.action) return e.action
  if (e.uno) return 'office.uno:' + e.uno
  return null
}

/** Command name part of a `.uno:` entry (before any JSON args) — the state key. */
export function stateKeyFor(e: Entry): string | null {
  if (!e.uno) return null
  const sp = e.uno.indexOf(' ')
  return sp > 0 ? e.uno.slice(0, sp) : e.uno
}

/** Entries for one app with separators collapsed (no leading/trailing/double). */
export function entriesFor(items: Entry[], code: string): Entry[] {
  const out: Entry[] = []
  let pendingSep = false
  for (const e of items) {
    if (e.sep) { pendingSep = out.length > 0; continue }
    if (!forApp(e, code)) continue
    if (e.sub) {
      const sub = entriesFor(e.sub, code)
      if (sub.length === 0) continue
      if (pendingSep) { out.push(SEP); pendingSep = false }
      out.push({ ...e, sub })
      continue
    }
    if (pendingSep) { out.push(SEP); pendingSep = false }
    out.push(e)
  }
  return out
}

/** Menus that exist for an app, in menu-bar order. */
export function menusFor(code: string): TopMenu[] {
  return OFFICE_MENU_TABLE.filter((mn) => forApp(mn, code)).map((mn) => ({ ...mn, items: entriesFor(mn.items, code) })).filter((mn) => mn.items.length > 0)
}

export interface PaletteCommand {
  id: string
  label: string
  /** "Format › Text" — where it lives in the menu bar. */
  path: string
  accel?: string
}

/** Every leaf command for the ⌘K palette, with its menu path. */
export function paletteCommands(type: number): PaletteCommand[] {
  const code = APP_CODE[type]
  if (!code) return []
  const out: PaletteCommand[] = []
  const walk = (items: Entry[], path: string[]): void => {
    for (const e of items) {
      if (e.sep) continue
      if (e.sub) { walk(e.sub, [...path, e.label]); continue }
      const id = actionIdFor(e)
      if (id) out.push({ id, label: e.label, path: path.join(' › '), accel: e.accel })
    }
  }
  for (const mn of menusFor(code)) walk(mn.items, [mn.label])
  return out
}
