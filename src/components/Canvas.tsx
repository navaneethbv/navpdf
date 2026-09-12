import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { call } from "../api";
import type {
  Details,
  DocInfo,
  Point,
  Rect,
  SearchHit,
  Selection,
  Tool,
} from "../types";
interface Props {
  doc: DocInfo;
  page: number;
  zoom: number;
  tool: Tool;
  busy: boolean;
  details: Details;
  hits: SearchHit[];
  selection: Selection | null;
  onSelect: (s: Selection) => void;
  onStroke: (points: Point[]) => void;
  onError: (message: string) => void;
}
export function Canvas({
  doc,
  page,
  zoom,
  tool,
  busy,
  details,
  hits,
  selection,
  onSelect,
  onStroke,
  onError,
}: Props) {
  const [image, setImage] = useState("");
  const [loaded, setLoaded] = useState(-1);
  const [points, setPoints] = useState<Point[]>([]);
  const [drag, setDrag] = useState<Rect | null>(null);
  const start = useRef<Point | null>(null);
  const stroke = useRef<Point[]>([]);
  const paper = useRef<HTMLDivElement>(null);
  const dimensions = doc.pages[page];
  const scale = zoom / 100;
  useEffect(() => {
    let alive = true;
    call<{ image: string }>({
      op: "render",
      page,
      scale: Math.min(3, Math.max(1.5, scale * window.devicePixelRatio)),
    })
      .then((r) => {
        if (alive) {
          setImage(r.image);
          setLoaded(doc.revision);
        }
      })
      .catch((e) => {
        if (alive) onError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [page, doc.revision, scale, onError]);
  useEffect(() => {
    setImage("");
  }, [page]);
  function point(e: PointerEvent): Point {
    const box = paper.current!.getBoundingClientRect();
    return [
      Math.max(0, Math.min(dimensions.width, (e.clientX - box.left) / scale)),
      Math.max(0, Math.min(dimensions.height, (e.clientY - box.top) / scale)),
    ];
  }
  function down(e: PointerEvent<HTMLDivElement>) {
    if (
      busy ||
      loaded !== doc.revision ||
      tool === "select" ||
      tool === "replaceText"
    )
      return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = point(e);
    stroke.current = [start.current];
    setPoints(stroke.current);
  }
  function move(e: PointerEvent) {
    if (!start.current) return;
    const p = point(e);
    if (tool === "draw" || tool === "signature") {
      stroke.current = [...stroke.current, p];
      setPoints(stroke.current);
    } else
      setDrag([
        Math.min(start.current[0], p[0]),
        Math.min(start.current[1], p[1]),
        Math.max(start.current[0], p[0]),
        Math.max(start.current[1], p[1]),
      ]);
  }
  function up(e: PointerEvent) {
    if (!start.current) return;
    const p = point(e);
    const a = start.current;
    start.current = null;
    setDrag(null);
    setPoints([]);
    if (tool === "draw" || tool === "signature") {
      if (stroke.current.length > 1) onStroke(stroke.current);
      return;
    }
    if (tool === "comment") {
      onSelect({
        rect: [
          a[0],
          a[1],
          Math.min(a[0] + 24, dimensions.width),
          Math.min(a[1] + 24, dimensions.height),
        ],
      });
      return;
    }
    let rect: Rect = [
      Math.min(a[0], p[0]),
      Math.min(a[1], p[1]),
      Math.max(a[0], p[0]),
      Math.max(a[1], p[1]),
    ];
    if (rect[2] - rect[0] < 4 || rect[3] - rect[1] < 4) {
      if (tool === "text")
        rect = [
          a[0],
          a[1],
          Math.min(a[0] + 240, dimensions.width),
          Math.min(a[1] + 70, dimensions.height),
        ];
      else return;
    }
    onSelect({ rect });
  }
  const box = (r: Rect) => ({
    left: r[0] * scale,
    top: r[1] * scale,
    width: (r[2] - r[0]) * scale,
    height: (r[3] - r[1]) * scale,
  });
  return (
    <div className="canvas-scroll">
      <div
        className={`paper tool-${tool} ${busy ? "paper-busy" : ""}`}
        ref={paper}
        style={{
          width: dimensions.width * scale,
          height: dimensions.height * scale,
        }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => {
          start.current = null;
          setPoints([]);
          setDrag(null);
        }}
        aria-label={`PDF page ${page + 1}`}
      >
        {image ? (
          <img
            src={image}
            alt={`Page ${page + 1} of ${doc.name}`}
            draggable={false}
          />
        ) : (
          <div className="page-loading">Rendering page...</div>
        )}
        {(tool === "replaceText" || tool === "select") &&
          loaded === doc.revision &&
          details.spans.map((span, i) =>
            tool === "replaceText" ? (
              <button
                key={i}
                className="text-target"
                aria-label={`Edit: ${span.text}`}
                style={box(span.rect)}
                disabled={busy}
                onClick={() =>
                  onSelect({
                    rect: span.rect,
                    origin: span.origin,
                    text: span.text,
                    size: Math.round(span.size),
                    color: span.color,
                    font: /bold/i.test(span.font)
                      ? "hebo"
                      : /times/i.test(span.font)
                        ? "tiro"
                        : "helv",
                  })
                }
              />
            ) : (
              <span
                key={i}
                className="selectable-text"
                style={{ ...box(span.rect), fontSize: span.size * scale }}
              >
                {span.text}
              </span>
            ),
          )}
        {hits
          .filter((h) => h.page === page)
          .map((hit, i) => (
            <div key={i} className="search-hit" style={box(hit.rect)} />
          ))}
        {(drag || selection) && (
          <div
            className={`selection ${tool === "redact" ? "redaction" : ""}`}
            style={box(drag || selection!.rect)}
          />
        )}
        {points.length > 1 && (
          <svg
            className="stroke-preview"
            viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
          >
            <polyline
              points={points.map((p) => p.join(",")).join(" ")}
              fill="none"
              stroke="#24634c"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
    </div>
  );
}
export function Thumbnail({
  page,
  revision,
  selected,
  onClick,
}: {
  page: number;
  revision: number;
  selected: boolean;
  onClick: () => void;
}) {
  const [image, setImage] = useState("");
  const ref = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    call<{ image: string }>({ op: "render", page, scale: 0.23 })
      .then((r) => {
        if (alive) setImage(r.image);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [page, revision, visible]);
  return (
    <button
      className={`thumbnail ${selected ? "selected" : ""}`}
      ref={ref}
      onClick={onClick}
      aria-label={`Go to page ${page + 1}`}
      aria-current={selected ? "page" : undefined}
    >
      <div>
        {image ? (
          <img src={image} alt="" />
        ) : (
          <span className="thumb-placeholder" />
        )}
      </div>
      <span>{page + 1}</span>
    </button>
  );
}
