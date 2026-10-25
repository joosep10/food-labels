import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { PDFDocument, rgb } from "npm:pdf-lib@1.17.1";

import fontkit from "npm:@pdf-lib/fontkit@1.1.1";

interface Food {
  name_et: string;
  name_en?: string | null;
}

interface ReqPayload {
  foods: Food[];
  language: "et" | "en" | "both";
  action?: "download" | "email";
}

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const THICKNESS = 1;

const MARGIN = 0; // ~12 mm, oli 10
const GAP = 1;

const COLUMNS = 2;

// Label height in PDF points.
// 70 pt ≈ 24.7 mm.
const LABEL_HEIGHT = 160;

const CONTENT_WIDTH = A4_WIDTH - MARGIN * 2 - GAP;

const LABEL_WIDTH = CONTENT_WIDTH / COLUMNS;

const ROWS_PER_PAGE = Math.floor(
  (A4_HEIGHT - MARGIN * 2 + GAP) / (LABEL_HEIGHT + GAP),
);

const LABELS_PER_PAGE = ROWS_PER_PAGE * COLUMNS;

function wrapText(
  text: string,
  font: any,
  fontSize: number,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];

  let current = "";

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;

    const width = font.widthOfTextAtSize(test, fontSize);

    if (width <= maxWidth) {
      current = test;
    } else {
      if (current) {
        lines.push(current);
      }

      current = word;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function drawCenteredText(
  page: any,
  text: string,
  x: number,
  y: number,
  width: number,
  font: any,
  fontSize: number,
  textColor: any,
) {
  const textWidth = font.widthOfTextAtSize(text, fontSize);

  page.drawText(text, {
    x: x + (width - textWidth) / 2,
    y,
    size: fontSize,
    font,
    color: textColor,
  });
}

async function sendEmail(pdfBytes: Uint8Array): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");

  const recipient = Deno.env.get("TEST_EMAIL");

  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  if (!recipient) {
    throw new Error("TEST_EMAIL is not configured");
  }

  // Convert PDF bytes to base64.
  let binary = "";

  const chunkSize = 0x8000;

  for (let i = 0; i < pdfBytes.length; i += chunkSize) {
    binary += String.fromCharCode(...pdfBytes.subarray(i, i + chunkSize));
  }

  const pdfBase64 = btoa(binary);

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "onboarding@resend.dev",
      to: [recipient],
      subject: "Food labels",
      text: "Attached are the generated food labels.",
      attachments: [
        {
          filename: "food-labels.pdf",
          content: pdfBase64,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(`Resend error: ${errorText}`);
  }
}

export default {
  fetch: async (req: Request) => {
    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers":
            "authorization, x-client-info, apikey, content-type",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
        },
      });
    }

    try {
      if (req.method !== "POST") {
        return Response.json(
          {
            error: "POST required",
          },
          {
            status: 405,
            headers: {
              "Access-Control-Allow-Origin": "*",
            },
          },
        );
      }

      const body = (await req.json()) as ReqPayload;

      if (!Array.isArray(body.foods) || body.foods.length === 0) {
        return Response.json(
          {
            error: "No foods supplied",
          },
          {
            status: 400,
            headers: {
              "Access-Control-Allow-Origin": "*",
            },
          },
        );
      }

      if (!["et", "en", "both"].includes(body.language)) {
        return Response.json(
          {
            error: "Invalid language",
          },
          {
            status: 400,
            headers: {
              "Access-Control-Allow-Origin": "*",
            },
          },
        );
      }

      // ----------------------------------
      // Create PDF
      // ----------------------------------

      const pdfDoc = await PDFDocument.create();
      pdfDoc.registerFontkit(fontkit);

      // Load the local font file.
      const fontBytes = await Deno.readFile(
        new URL("./fonts/CourierNewBold.ttf", import.meta.url),
      );

      const font = await pdfDoc.embedFont(fontBytes);

      // 16px ≈ 12pt in a PDF.
      const FONT_SIZE = 15;

      // Slightly smaller English text.
      const EN_FONT_SIZE = 13;

      // English is dark gray rather than black.
      const ENGLISH_COLOR = rgb(0.35, 0.35, 0.35);

      const BORDER_COLOR = rgb(0.75, 0.75, 0.75);
      // const BORDER_COLOR = rgb(0, 0, 0);

      let page: any = null;

      // ----------------------------------
      // Draw labels
      // ----------------------------------

      for (let index = 0; index < body.foods.length; index++) {
        if (index % LABELS_PER_PAGE === 0) {
          page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
        }

        const position = index % LABELS_PER_PAGE;

        const row = Math.floor(position / COLUMNS);

        const column = position % COLUMNS;

        const x = MARGIN + column * (LABEL_WIDTH + GAP);

        const y = A4_HEIGHT - MARGIN - (row + 1) * LABEL_HEIGHT - row * GAP;

        const food = body.foods[index];

        // --------------------------------
        // Label border
        // --------------------------------

        // Draw the top and bottom borders.
        // page.drawLine({
        //   start: { x, y: y + LABEL_HEIGHT },
        //   end: {
        //     x: x + LABEL_WIDTH,
        //     y: y + LABEL_HEIGHT,
        //   },
        //   thickness: THICKNESS,
        //   color: BORDER_COLOR,
        // });

        page.drawLine({
          start: { x, y },
          end: {
            x: x + LABEL_WIDTH,
            y,
          },
          thickness: THICKNESS,
          color: BORDER_COLOR,
        });

        // Draw the outer vertical borders only.
        if (column === 0) {
          page.drawLine({
            start: { x, y },
            end: {
              x,
              y: y + LABEL_HEIGHT,
            },
            thickness: THICKNESS,
            color: BORDER_COLOR,
          });
        }

        if (column === COLUMNS - 1) {
          page.drawLine({
            start: {
              x: x + LABEL_WIDTH,
              y,
            },
            end: {
              x: x + LABEL_WIDTH,
              y: y + LABEL_HEIGHT,
            },
            thickness: THICKNESS,
            color: BORDER_COLOR,
          });
        }

        const SIDE_PADDING = 12;

        const textWidth = LABEL_WIDTH - SIDE_PADDING * 2;

        // --------------------------------
        // Both languages
        // --------------------------------

        if (body.language === "both") {
          const etLines = wrapText(food.name_et, font, FONT_SIZE, textWidth);

          const enLines = food.name_en
            ? wrapText(food.name_en, font, EN_FONT_SIZE, textWidth)
            : [];

          const ET_LINE_HEIGHT = 15;
          const EN_LINE_HEIGHT = 13;

          const totalHeight =
            etLines.length * ET_LINE_HEIGHT + enLines.length * EN_LINE_HEIGHT;

          // The top of the usable text area.
          // The bottom 30px remains protected.
          let currentY = y + (LABEL_HEIGHT + totalHeight) / 2 - ET_LINE_HEIGHT;

          for (const line of etLines) {
            drawCenteredText(
              page,
              line,
              x,
              currentY,
              LABEL_WIDTH,
              font,
              FONT_SIZE,
              rgb(0, 0, 0),
            );

            currentY -= ET_LINE_HEIGHT;
          }

          for (const line of enLines) {
            drawCenteredText(
              page,
              line,
              x,
              currentY,
              LABEL_WIDTH,
              font,
              EN_FONT_SIZE,
              ENGLISH_COLOR,
            );

            currentY -= EN_LINE_HEIGHT;
          }

          continue;
        }

        // --------------------------------
        // Single language
        // --------------------------------

        const text =
          body.language === "en" ? food.name_en || food.name_et : food.name_et;

        const lines = wrapText(text, font, FONT_SIZE, textWidth);

        const LINE_HEIGHT = 14;

        const totalHeight = lines.length * LINE_HEIGHT;

        // Usable area ends 30px above
        // the bottom of the label.
        let currentY = y + (LABEL_HEIGHT + totalHeight) / 2 - LINE_HEIGHT;

        for (const line of lines) {
          drawCenteredText(
            page,
            line,
            x,
            currentY,
            LABEL_WIDTH,
            font,
            FONT_SIZE,
            rgb(0, 0, 0),
          );

          currentY -= LINE_HEIGHT;
        }
      }

      // ----------------------------------
      // Draw shared vertical lines
      // ----------------------------------

      for (let pageIndex = 0; pageIndex < pdfDoc.getPageCount(); pageIndex++) {
        const currentPage = pdfDoc.getPage(pageIndex);

        const centerX = MARGIN + LABEL_WIDTH + GAP / 2;

        const rowsOnPage =
          pageIndex === pdfDoc.getPageCount() - 1
            ? Math.min(
                ROWS_PER_PAGE,
                Math.ceil(body.foods.length - pageIndex * LABELS_PER_PAGE) /
                  COLUMNS,
              )
            : ROWS_PER_PAGE;

        const rowCount = Math.ceil(rowsOnPage);

        for (let row = 0; row < rowCount; row++) {
          const rowY =
            A4_HEIGHT - MARGIN - (row + 1) * LABEL_HEIGHT - row * GAP;

          currentPage.drawLine({
            start: {
              x: centerX,
              y: rowY,
            },
            end: {
              x: centerX,
              y: rowY + LABEL_HEIGHT,
            },
            thickness: THICKNESS,
            color: BORDER_COLOR,
          });
        }
      }

      // ----------------------------------
      // Return PDF
      // ----------------------------------

      const pdfBytes = await pdfDoc.save();

      if (body.action === "email") {
        await sendEmail(pdfBytes);

        return Response.json(
          {
            success: true,
            message: "Email sent successfully.",
          },
          {
            headers: {
              "Access-Control-Allow-Origin": "*",
            },
          },
        );
      }

      return new Response(pdfBytes, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers":
            "authorization, x-client-info, apikey, content-type",
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="food-labels.pdf"',
        },
      });
    } catch (error) {
      console.error(error);

      return Response.json(
        {
          error: error instanceof Error ? error.message : "Unknown error",
        },
        {
          status: 500,
          headers: {
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    }
  },
};
