#!/usr/bin/env python3
"""PPTX design system for the Workspace OS office generator.

A small, dependency-light "design system" layered on top of python-pptx so a
minimal spec still produces a modern, polished deck. gen.py owns the spec →
slide dispatch; this module owns the LOOK: palette, type scale, layout
primitives (accent bars, dividers, slide numbers) and the per-layout renderers
(cover / section / bullets / table / chart / closing).

Everything degrades gracefully: any missing spec field falls back to a sensible
default, and every font is requested by name with a clean-sans fallback chain
that the LibreOffice canvas renderer is very likely to satisfy.
"""
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION, XL_TICK_MARK
from pptx.oxml.ns import qn


# ---------------------------------------------------------------------------
# Palette + type scale
# ---------------------------------------------------------------------------

# A calm, modern default palette (deep ink + a confident blue primary + a warm
# amber accent). Overridable per-deck via spec["theme"]["palette"].
DEFAULT_PALETTE = {
    "bg": "FFFFFF",      # slide background
    "ink": "1A2233",     # primary text
    "primary": "2D5BFF", # brand / headings / cover fill
    "accent": "FF8A3D",  # accent bars, emphasis
    "muted": "8A93A6",   # subtitles, captions, secondary text
}

# Slide 16:9 canvas.
SLIDE_W = Inches(13.333)
SLIDE_H = Inches(7.5)
MARGIN = Inches(0.9)          # generous outer margin (the grid's left/right)
CONTENT_W = SLIDE_W - 2 * MARGIN

# A clean modern sans that LibreOffice almost always resolves; if the exact face
# is missing the renderer falls back within the same humanist-sans family.
DEFAULT_FONT = "Inter"

# Type scale (points). One scale, used everywhere, so sizing stays consistent.
TYPE = {
    "cover_title": 54,
    "cover_subtitle": 24,
    "section_kicker": 16,
    "section_title": 40,
    "title": 30,
    "subtitle": 18,
    "heading": 22,
    "body": 19,
    "bullet_l2": 16,
    "table": 15,
    "caption": 12,
    "page_num": 11,
}


def _rgb(hexstr):
    return RGBColor.from_string(hexstr.lstrip("#"))


class Design:
    """Resolves a deck's theme once, then paints slides with it."""

    def __init__(self, theme):
        theme = theme or {}
        pal = dict(DEFAULT_PALETTE)
        # Back-compat: old specs used flat theme.primary / theme.accent.
        if theme.get("primary"):
            pal["primary"] = theme["primary"]
        if theme.get("accent"):
            pal["accent"] = theme["accent"]
        pal.update(theme.get("palette", {}) or {})
        self.pal = {k: _rgb(v) for k, v in pal.items()}
        self.font = theme.get("font", DEFAULT_FONT)

    # -- low-level helpers --------------------------------------------------

    def _apply_font(self, run, size, color, bold=False, font=None):
        run.font.size = Pt(size)
        run.font.bold = bold
        run.font.color.rgb = color
        run.font.name = font or self.font

    def _fill(self, shape, color):
        shape.fill.solid()
        shape.fill.fore_color.rgb = color
        shape.line.fill.background()

    def rect(self, slide, x, y, w, h, color):
        sp = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, w, h)
        self._fill(sp, color)
        sp.shadow.inherit = False
        return sp

    def text(self, slide, x, y, w, h, text, size, color, bold=False,
             align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, font=None,
             name=None, link=None):
        """A single-run textbox. `name` sets the shape name (metric anchor);
        `link` makes the run a clickable hyperlink."""
        tb = slide.shapes.add_textbox(x, y, w, h)
        tf = tb.text_frame
        tf.word_wrap = True
        tf.vertical_anchor = anchor
        tf.margin_left = 0
        tf.margin_right = 0
        p = tf.paragraphs[0]
        p.alignment = align
        r = p.add_run()
        r.text = str(text)
        self._apply_font(r, size, color, bold, font)
        if link:
            r.hyperlink.address = str(link)
        if name:
            tb.name = name
        return tb

    def page_number(self, slide, n):
        self.text(
            slide, SLIDE_W - Inches(1.2), SLIDE_H - Inches(0.5),
            Inches(0.8), Inches(0.35), str(n), TYPE["page_num"],
            self.pal["muted"], align=PP_ALIGN.RIGHT,
        )

    def accent_rule(self, slide, x, y, w=Inches(0.9), thick=Inches(0.06)):
        """A short accent bar used under titles — the deck's signature mark."""
        self.rect(slide, x, y, w, thick, self.pal["accent"])

    def slide_title(self, slide, text):
        """Standard content-slide title with an accent rule beneath it."""
        self.text(slide, MARGIN, Inches(0.55), CONTENT_W, Inches(0.9),
                  text, TYPE["title"], self.pal["ink"], bold=True)
        self.accent_rule(slide, MARGIN, Inches(1.5))

    # -- layouts ------------------------------------------------------------

    def cover(self, slide, s):
        """Full-bleed primary panel + oversized title + accent underline."""
        self.rect(slide, 0, 0, SLIDE_W, SLIDE_H, self.pal["primary"])
        # A layered darker band at the bottom for depth (gradient-ish).
        self.rect(slide, 0, SLIDE_H - Inches(2.2), SLIDE_W, Inches(2.2),
                  self._mix(self.pal["primary"], 0.12))
        white = _rgb("FFFFFF")
        if s.get("kicker"):
            self.text(slide, MARGIN, Inches(2.0), CONTENT_W, Inches(0.5),
                      s["kicker"].upper(), TYPE["section_kicker"],
                      self.pal["accent"], bold=True)
        self.text(slide, MARGIN, Inches(2.5), CONTENT_W, Inches(2.2),
                  s.get("title", ""), TYPE["cover_title"], white, bold=True)
        self.accent_rule(slide, MARGIN, Inches(4.75), w=Inches(1.4),
                         thick=Inches(0.08))
        if s.get("subtitle"):
            self.text(slide, MARGIN, Inches(5.0), CONTENT_W, Inches(1.0),
                      s["subtitle"], TYPE["cover_subtitle"],
                      _rgb("E8ECFF"))

    def section(self, slide, s):
        """A divider slide: dark panel, big numbered/kicker heading."""
        self.rect(slide, 0, 0, SLIDE_W, SLIDE_H, self.pal["ink"])
        # Left accent column.
        self.rect(slide, 0, 0, Inches(0.35), SLIDE_H, self.pal["accent"])
        if s.get("kicker"):
            self.text(slide, Inches(1.1), Inches(2.6), CONTENT_W, Inches(0.5),
                      s["kicker"].upper(), TYPE["section_kicker"],
                      self.pal["accent"], bold=True)
        self.text(slide, Inches(1.1), Inches(3.05), CONTENT_W, Inches(1.6),
                  s.get("title", ""), TYPE["section_title"], _rgb("FFFFFF"),
                  bold=True)
        if s.get("subtitle"):
            self.text(slide, Inches(1.1), Inches(4.5), CONTENT_W, Inches(1.0),
                      s["subtitle"], TYPE["subtitle"], _rgb("C9CFDD"))

    def bullets(self, slide, s):
        if s.get("title"):
            self.slide_title(slide, s["title"])
        tb = slide.shapes.add_textbox(MARGIN, Inches(1.85), CONTENT_W,
                                      Inches(5.0))
        tf = tb.text_frame
        tf.word_wrap = True
        first = True
        for b in s.get("bullets", []):
            level = 0
            text = b
            href = None
            if isinstance(b, dict):
                text = b.get("text", "")
                level = int(b.get("level", 0))
                href = b.get("href") or b.get("link")
            p = tf.paragraphs[0] if first else tf.add_paragraph()
            first = False
            p.level = level
            p.space_after = Pt(10)
            p.line_spacing = 1.15
            # Real bullet glyph via list formatting (no literal "• ").
            self._set_bullet(p, level)
            r = p.add_run()
            r.text = str(text)
            size = TYPE["body"] if level == 0 else TYPE["bullet_l2"]
            # A linked bullet reads as a link (accent colour) and is clickable;
            # in-app the LOK hyperlink callback opens it in the Workspace browser.
            color = self.pal["accent"] if href else (self.pal["ink"] if level == 0 else self.pal["muted"])
            self._apply_font(r, size, color, bold=False)
            if href:
                r.hyperlink.address = str(href)

    def table(self, slide, s):
        if s.get("title"):
            self.slide_title(slide, s["title"])
        spec = s["table"]
        hdr = spec["headers"]
        rows = spec["rows"]
        right = set(spec.get("numericCols", []))  # 1-based cols to right-align
        n_rows = len(rows) + 1
        top = Inches(1.9)
        gt = slide.shapes.add_table(
            n_rows, len(hdr), MARGIN, top, CONTENT_W,
            Inches(min(0.5 * n_rows, 5.0))
        ).table
        gt.first_row = False  # we style banding ourselves
        try:
            gt.horz_banding = False
        except Exception:
            pass
        # Header row.
        for c, h in enumerate(hdr):
            self._cell(gt.cell(0, c), str(h), self.pal["primary"],
                       _rgb("FFFFFF"), bold=True,
                       align=PP_ALIGN.RIGHT if (c + 1) in right else PP_ALIGN.LEFT)
        # Body rows with subtle zebra banding.
        band = self._mix(self.pal["primary"], 0.94, toward_white=True)
        for r, row in enumerate(rows, 1):
            fill = band if r % 2 == 0 else _rgb("FFFFFF")
            for c, val in enumerate(row):
                self._cell(gt.cell(r, c), str(val), fill, self.pal["ink"],
                           align=PP_ALIGN.RIGHT if (c + 1) in right else PP_ALIGN.LEFT)

    def chart(self, slide, s):
        if s.get("title"):
            self.slide_title(slide, s["title"])
        ch = s["chart"]
        data = CategoryChartData()
        data.categories = ch["categories"]
        for ser in ch["series"]:
            data.add_series(ser["name"], ser["values"])
        kind = {
            "bar": XL_CHART_TYPE.COLUMN_CLUSTERED,
            "column": XL_CHART_TYPE.COLUMN_CLUSTERED,
            "line": XL_CHART_TYPE.LINE_MARKERS,
            "pie": XL_CHART_TYPE.PIE,
        }.get(ch.get("type", "bar"), XL_CHART_TYPE.COLUMN_CLUSTERED)
        gf = slide.shapes.add_chart(kind, MARGIN, Inches(1.9), CONTENT_W,
                                    Inches(5.0), data)
        self._style_chart(gf.chart, ch)

    def closing(self, slide, s):
        self.rect(slide, 0, 0, SLIDE_W, SLIDE_H, self.pal["ink"])
        self.accent_rule(slide, MARGIN, Inches(2.9), w=Inches(1.4),
                         thick=Inches(0.08))
        self.text(slide, MARGIN, Inches(3.1), CONTENT_W, Inches(1.6),
                  s.get("title", "Thank you"), TYPE["cover_title"],
                  _rgb("FFFFFF"), bold=True)
        if s.get("subtitle"):
            self.text(slide, MARGIN, Inches(4.7), CONTENT_W, Inches(1.0),
                      s["subtitle"], TYPE["subtitle"], self.pal["muted"])

    # -- internals ----------------------------------------------------------

    def _cell(self, cell, text, fill, color, bold=False, align=PP_ALIGN.LEFT):
        cell.fill.solid()
        cell.fill.fore_color.rgb = fill
        cell.margin_top = Pt(4)
        cell.margin_bottom = Pt(4)
        cell.margin_left = Pt(10)
        cell.margin_right = Pt(10)
        cell.vertical_anchor = MSO_ANCHOR.MIDDLE
        cell.text = ""
        p = cell.text_frame.paragraphs[0]
        p.alignment = align
        r = p.add_run()
        r.text = text
        self._apply_font(r, TYPE["table"], color, bold)

    def _set_bullet(self, paragraph, level):
        """Sets a real filled/dash bullet char on a paragraph via XML."""
        pPr = paragraph._p.get_or_add_pPr()
        # Clear any existing bullet defs, then add a char bullet in accent color.
        for tag in ("a:buNone", "a:buChar", "a:buAutoNum"):
            for el in pPr.findall(qn(tag)):
                pPr.remove(el)
        char = "•" if level == 0 else "–"  # bullet for L0, en-dash L2
        buClr = pPr.makeelement(qn("a:buClr"), {})
        srgb = pPr.makeelement(qn("a:srgbClr"),
                               {"val": str(self.pal["accent"])})
        buClr.append(srgb)
        buChar = pPr.makeelement(qn("a:buChar"), {"char": char})
        pPr.append(buClr)
        pPr.append(buChar)

    def _style_chart(self, chart, ch):
        try:
            chart.has_title = False
            palette = [self.pal["primary"], self.pal["accent"],
                       self._mix(self.pal["primary"], 0.4, toward_white=True),
                       self.pal["muted"]]
            for i, plot_series in enumerate(chart.series):
                col = palette[i % len(palette)]
                fmt = plot_series.format
                fmt.fill.solid()
                fmt.fill.fore_color.rgb = col
                fmt.line.color.rgb = col
            if ch.get("type") in (None, "bar", "column", "line"):
                chart.has_legend = len(chart.series) > 1
                if chart.has_legend:
                    chart.legend.position = XL_LEGEND_POSITION.BOTTOM
                    chart.legend.include_in_layout = False
                for axis in (chart.category_axis, chart.value_axis):
                    axis.tick_labels.font.size = Pt(12)
                    axis.tick_labels.font.color.rgb = self.pal["muted"]
                    axis.minor_tick_mark = XL_TICK_MARK.NONE
                    axis.format.line.color.rgb = self._mix(
                        self.pal["muted"], 0.7, toward_white=True)
            else:  # pie
                chart.has_legend = True
                chart.legend.position = XL_LEGEND_POSITION.RIGHT
                chart.legend.include_in_layout = False
        except Exception:
            pass  # a themed-but-imperfect chart still beats a crash

    def _mix(self, color, amount, toward_white=False):
        """Blend `color` toward black (default) or white by `amount` (0..1)."""
        target = 255 if toward_white else 0
        r = int(color[0] + (target - color[0]) * amount)
        g = int(color[1] + (target - color[1]) * amount)
        b = int(color[2] + (target - color[2]) * amount)
        return RGBColor(max(0, min(255, r)), max(0, min(255, g)),
                        max(0, min(255, b)))
