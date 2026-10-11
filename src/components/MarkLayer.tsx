import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import {
  HL_WIDTH,
  LINE_HEIGHT,
  PEN_WIDTH,
  TEXT_SIZE,
  hitsMark,
  newMarkId,
  strokePath,
  textLines,
  tidyPoints,
  type Mark,
  type MarkTool,
  type StrokeMark,
  type TextMark,
} from '../lib/marks'

interface Props {
  marks: Mark[]
  /** Page height / width. */
  aspect: number
  /** On-screen page width in CSS pixels (sizes the text editor). */
  pageWidth: number
  edit?: { tool: MarkTool; color: string; onChange: (marks: Mark[]) => void }
}

const VB = 1000 // SVG works in a 1000-wide box; marks are stored as page fractions.
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Draws a page's marks over the chart and, in markup mode, lets a leader add, move and erase them. */
export default function MarkLayer({ marks, aspect, pageWidth, edit }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [live, setLive] = useState<StrokeMark | null>(null)
  const [erasing, setErasing] = useState<Set<string>>(new Set())
  const [moving, setMoving] = useState<{ id: string; x: number; y: number } | null>(null)
  const [textEdit, setTextEdit] = useState<{ id: string | null; x: number; y: number; c: string; text: string } | null>(null)
  const textEditRef = useRef(textEdit)
  textEditRef.current = textEdit
  const pointers = useRef(new Set<number>())
  const drag = useRef<{ id: string; offX: number; offY: number; sx: number; sy: number; moved: boolean } | null>(null)
  const marksRef = useRef(marks)
  marksRef.current = marks

  // Leaving markup mode (or this page) finishes any text being typed.
  useEffect(() => {
    if (!edit) commitText()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit?.tool, !!edit])
  useEffect(() => () => commitText(), []) // eslint-disable-line react-hooks/exhaustive-deps

  const H = VB * aspect

  function toPage(e: PointerEvent): [number, number] {
    const r = svgRef.current!.getBoundingClientRect()
    return [clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height)]
  }

  function commitText() {
    const t = textEditRef.current
    if (!t || !edit) {
      textEditRef.current = null
      setTextEdit(null)
      return
    }
    textEditRef.current = null
    setTextEdit(null)
    const text = t.text.replace(/\s+$/, '')
    const current = marksRef.current
    if (t.id) {
      const next = text
        ? current.map((m) => (m.id === t.id && m.t === 'text' ? { ...m, text, c: m.c } : m))
        : current.filter((m) => m.id !== t.id)
      edit.onChange(next)
    } else if (text) {
      edit.onChange([...current, { id: newMarkId(), t: 'text', c: t.c, s: TEXT_SIZE, x: t.x, y: t.y, text }])
    }
  }

  function textAt(x: number, y: number): TextMark | undefined {
    return [...marks].reverse().find((m): m is TextMark => m.t === 'text' && hitsMark(m, x, y, aspect, 0.01))
  }

  function eraseAt(x: number, y: number) {
    const hit = marks.filter((m) => !erasing.has(m.id) && hitsMark(m, x, y, aspect))
    if (hit.length) setErasing((prev) => new Set([...prev, ...hit.map((m) => m.id)]))
  }

  function onPointerDown(e: PointerEvent<SVGSVGElement>) {
    if (!edit) return
    // Keep focus where it is (no stray blur), and stop the page from scrolling under the pen.
    e.preventDefault()
    pointers.current.add(e.pointerId)
    if (pointers.current.size > 1) {
      // A second finger means pinch/pan, not drawing.
      setLive(null)
      drag.current = null
      setMoving(null)
      setErasing(new Set())
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    const [x, y] = toPage(e)
    if (edit.tool === 'pen' || edit.tool === 'hl') {
      commitText()
      setLive({ id: newMarkId(), t: edit.tool, c: edit.color, w: edit.tool === 'hl' ? HL_WIDTH : PEN_WIDTH, p: [[x, y]] })
    } else if (edit.tool === 'erase') {
      commitText()
      eraseAt(x, y)
    } else {
      const hit = textAt(x, y)
      if (hit && textEditRef.current?.id !== hit.id) {
        commitText()
        drag.current = { id: hit.id, offX: x - hit.x, offY: y - hit.y, sx: e.clientX, sy: e.clientY, moved: false }
      } else if (!hit) {
        const had = !!textEditRef.current
        commitText()
        // First tap away from an open note just closes it; the next tap starts a new one.
        if (!had) setTextEdit({ id: null, x, y: clamp01(y - TEXT_SIZE / aspect / 2), c: edit.color, text: '' })
      }
    }
  }

  function onPointerMove(e: PointerEvent<SVGSVGElement>) {
    if (!edit || pointers.current.size !== 1 || !pointers.current.has(e.pointerId)) return
    const events = 'getCoalescedEvents' in e.nativeEvent ? e.nativeEvent.getCoalescedEvents() : []
    if (live) {
      const r = svgRef.current!.getBoundingClientRect()
      const pts = (events.length ? events : [e.nativeEvent]).map(
        (ev) => [clamp01((ev.clientX - r.left) / r.width), clamp01((ev.clientY - r.top) / r.height)] as [number, number],
      )
      setLive((l) => (l ? { ...l, p: [...l.p, ...pts] } : l))
    } else if (edit.tool === 'erase') {
      const [x, y] = toPage(e)
      eraseAt(x, y)
    } else if (drag.current) {
      const d = drag.current
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 6) return
      d.moved = true
      const [x, y] = toPage(e)
      setMoving({ id: d.id, x: clamp01(x - d.offX), y: clamp01(y - d.offY) })
    }
  }

  function onPointerUp(e: PointerEvent<SVGSVGElement>) {
    if (!pointers.current.delete(e.pointerId) || !edit) return
    if (pointers.current.size > 0) return
    const cancelled = e.type === 'pointercancel'
    if (live) {
      if (!cancelled) edit.onChange([...marks, { ...live, p: tidyPoints(live.p) }])
      setLive(null)
    } else if (erasing.size) {
      if (!cancelled) edit.onChange(marks.filter((m) => !erasing.has(m.id)))
      setErasing(new Set())
    } else if (drag.current) {
      const d = drag.current
      drag.current = null
      if (cancelled) setMoving(null)
      else if (d.moved && moving) {
        edit.onChange(marks.map((m) => (m.id === d.id && m.t === 'text' ? { ...m, x: moving.x, y: moving.y } : m)))
        setMoving(null)
      } else {
        const m = marks.find((mk): mk is TextMark => mk.id === d.id && mk.t === 'text')
        if (m) setTextEdit({ id: m.id, x: m.x, y: m.y, c: m.c, text: m.text })
      }
    }
  }

  function onTextKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    e.stopPropagation() // don't turn pages while typing
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      commitText()
    } else if (e.key === 'Escape') {
      textEditRef.current = null
      setTextEdit(null)
    }
  }

  const shown = marks
    .filter((m) => !erasing.has(m.id) && m.id !== textEdit?.id)
    .map((m) => (moving && m.id === moving.id && m.t === 'text' ? { ...m, x: moving.x, y: moving.y } : m))
  if (live) shown.push(live)

  return (
    <>
      <svg
        ref={svgRef}
        className={`marks ${edit ? 'editing' : ''} ${edit ? `tool-${edit.tool}` : ''}`}
        viewBox={`0 0 ${VB} ${H}`}
        preserveAspectRatio="none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={(e) => edit && e.stopPropagation()}
      >
        {shown.map((m) =>
          m.t === 'text' ? (
            <text
              key={m.id}
              x={m.x * VB}
              y={m.y * H + m.s * VB * 0.85}
              fontSize={m.s * VB}
              fill={m.c}
              className="mark-text"
              strokeWidth={m.s * VB * 0.14}
            >
              {textLines(m).map((line, i) => (
                <tspan key={i} x={m.x * VB} dy={i === 0 ? 0 : m.s * VB * LINE_HEIGHT}>
                  {line || ' '}
                </tspan>
              ))}
            </text>
          ) : (
            <path
              key={m.id}
              d={strokePath(m.p, VB, H)}
              stroke={m.c}
              strokeWidth={m.w * VB}
              className={m.t === 'hl' ? 'mark-hl' : 'mark-pen'}
            />
          ),
        )}
      </svg>
      {textEdit && edit && (
        <textarea
          className="mark-input"
          autoFocus
          rows={Math.max(1, textEdit.text.split('\n').length)}
          placeholder="Note"
          value={textEdit.text}
          style={{
            left: `${textEdit.x * 100}%`,
            top: `${textEdit.y * 100}%`,
            color: textEdit.c,
            fontSize: TEXT_SIZE * pageWidth,
          }}
          onChange={(e) => setTextEdit((t) => (t ? { ...t, text: e.target.value } : t))}
          onKeyDown={onTextKey}
          onBlur={commitText}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </>
  )
}
