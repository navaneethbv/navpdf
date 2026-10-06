import type { ViewerController } from "../viewer/controller";

/** The rendered page element under a pointer position, falling back to the first page. */
export function pageAt(clientX: number, clientY: number) {
  const fromPoint =
    typeof document.elementsFromPoint === "function"
      ? document
          .elementsFromPoint(clientX, clientY)
          .map((element) => element.closest<HTMLElement>(".page"))
          .find((element): element is HTMLElement => !!element)
      : null;
  if (fromPoint) return fromPoint;
  const pages = [...document.querySelectorAll<HTMLElement>(".page")];
  const matchingPage = pages.find((page) => {
    const rect = page.getBoundingClientRect();
    return (
      clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
    );
  });
  return matchingPage ?? pages[0];
}

/** Converts a pointer position over a page element to PDF user-space coordinates. */
export async function pdfPoint(
  controller: ViewerController,
  pageElement: HTMLElement,
  clientX: number,
  clientY: number,
): Promise<[number, number]> {
  const pageNumber = Number(pageElement.dataset.pageNumber);
  const page = await controller.pdf!.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1, rotation: page.rotate });
  const rect = pageElement.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * viewport.width;
  const y = ((clientY - rect.top) / rect.height) * viewport.height;
  const point = viewport.convertToPdfPoint(x, y);
  return [point[0], point[1]];
}
