import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import {
  add3dModel,
  extract3dModel,
  list3dModels,
  modelFormat,
} from "../../src/services/pdf/three-d";

const u3d = new Uint8Array([0x55, 0x33, 0x44, 0x00, 1, 2, 3, 4, 5, 6, 7, 8]);
const prc = new TextEncoder().encode("PRC0123456789");

async function blank() {
  const doc = await PDFDocument.create();
  doc.addPage([600, 800]);
  doc.addPage([600, 800]);
  return doc.save();
}

// A 1x1 PNG.
const png = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

describe("3D models", () => {
  it("recognises U3D and PRC from their contents", () => {
    expect(modelFormat(u3d)).toBe("U3D");
    expect(modelFormat(prc)).toBe("PRC");
    expect(modelFormat(new TextEncoder().encode("%PDF"))).toBeNull();
  });

  it("adds a model with a poster, lists it and saves the model back unchanged", async () => {
    const bytes = await add3dModel(await blank(), {
      page: 2,
      rect: [50, 100, 350, 300],
      model: u3d,
      poster: { bytes: png, type: "png" },
      activation: "page-open",
      description: "Bracket",
    });
    const doc = await PDFDocument.load(bytes);
    const annotation = doc.context.lookup(doc.getPage(1).node.Annots()!.get(0), PDFDict);
    expect(annotation.lookup(PDFName.of("Subtype"), PDFName).decodeText()).toBe("3D");
    const activation = annotation.lookup(PDFName.of("3DA"), PDFDict);
    expect(activation.lookup(PDFName.of("A"), PDFName).decodeText()).toBe("PO");
    const stream = annotation.lookup(PDFName.of("3DD")) as PDFRawStream;
    expect(stream.dict.lookup(PDFName.of("Subtype"), PDFName).decodeText()).toBe("U3D");
    expect(stream.dict.has(PDFName.of("OnInstantiate"))).toBe(false);
    expect(annotation.lookup(PDFName.of("AP"), PDFDict).has(PDFName.of("N"))).toBe(true);
    expect(annotation.has(PDFName.of("JS"))).toBe(false);

    const listed = await list3dModels(bytes);
    expect(listed).toMatchObject([
      { page: 2, format: "U3D", views: 0, script: false, description: "Bracket" },
    ]);
    const saved = await extract3dModel(bytes, 0);
    expect(saved?.extension).toBe("u3d");
    expect(Array.from(saved?.bytes ?? [])).toEqual([...u3d]);
  });

  it("draws a labelled frame without a poster and refuses files that are not models", async () => {
    const bytes = await add3dModel(await blank(), {
      page: 1,
      rect: [0, 0, 200, 150],
      model: prc,
      activation: "click",
    });
    expect((await list3dModels(bytes))[0]).toMatchObject({ format: "PRC" });
    await expect(
      add3dModel(await blank(), {
        page: 1,
        rect: [0, 0, 200, 150],
        model: new TextEncoder().encode("not a model"),
        activation: "click",
      }),
    ).rejects.toThrow(/U3D or PRC/);
    await expect(
      add3dModel(await blank(), { page: 1, rect: [0, 0, 5, 5], model: u3d, activation: "click" }),
    ).rejects.toThrow(/10 points/);
    await expect(extract3dModel(bytes, 3)).resolves.toBeNull();
  });

  it("flags models that ask readers to run JavaScript", async () => {
    const doc = await PDFDocument.load(
      await add3dModel(await blank(), {
        page: 1,
        rect: [0, 0, 100, 100],
        model: u3d,
        activation: "click",
      }),
    );
    const annotation = doc.context.lookup(doc.getPage(0).node.Annots()!.get(0), PDFDict);
    (annotation.lookup(PDFName.of("3DD")) as PDFRawStream).dict.set(
      PDFName.of("OnInstantiate"),
      doc.context.obj({}),
    );
    expect((await list3dModels(await doc.save()))[0].script).toBe(true);
  });
});
