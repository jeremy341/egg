/**
 * ISO 3166-1 numeric id (as the world-atlas map files carry it) to alpha-2 code, for every
 * country in `countries-110m`. The map has no alpha-2 field, and the visit counts are stored by
 * alpha-2, so this is the join. Pure data, no imports.
 */
const PAIRS =
  "242FJ 834TZ 732EH 124CA 840US 398KZ 860UZ 598PG 360ID 032AR 152CL 180CD 706SO 404KE 729SD 148TD 332HT 214DO 643RU 044BS " +
  "238FK 578NO 304GL 260TF 626TL 710ZA 426LS 484MX 858UY 076BR 068BO 604PE 170CO 591PA 188CR 558NI 340HN 222SV 320GT 084BZ " +
  "862VE 328GY 740SR 250FR 218EC 630PR 388JM 192CU 716ZW 072BW 516NA 686SN 466ML 478MR 204BJ 562NE 566NG 120CM 768TG 288GH " +
  "384CI 324GN 624GW 430LR 694SL 854BF 140CF 178CG 266GA 226GQ 894ZM 454MW 508MZ 748SZ 024AO 108BI 376IL 422LB 450MG 275PS " +
  "270GM 788TN 012DZ 400JO 784AE 634QA 414KW 368IQ 512OM 548VU 116KH 764TH 418LA 104MM 704VN 408KP 410KR 496MN 356IN 050BD " +
  "064BT 524NP 586PK 004AF 762TJ 417KG 795TM 364IR 760SY 051AM 752SE 112BY 804UA 616PL 040AT 348HU 498MD 642RO 440LT 428LV " +
  "233EE 276DE 100BG 300GR 792TR 008AL 191HR 756CH 442LU 056BE 528NL 620PT 724ES 372IE 540NC 090SB 554NZ 036AU 144LK 156CN " +
  "158TW 380IT 208DK 826GB 352IS 031AZ 268GE 608PH 458MY 096BN 705SI 246FI 703SK 203CZ 232ER 392JP 600PY 887YE 682SA 010AQ " +
  "196CY 504MA 818EG 434LY 231ET 262DJ 800UG 646RW 070BA 807MK 688RS 499ME 780TT 728SS";

const BY_ID = new Map<string, string>(PAIRS.split(" ").map((p) => [p.slice(0, 3), p.slice(3)]));

/** The alpha-2 code for a map id and name, or null for a shape with no code (Somaliland, Northern Cyprus). */
export function codeForShape(id: string | number | undefined, name: string): string | null {
  if (id !== undefined && id !== "") return BY_ID.get(String(id).padStart(3, "0")) ?? null;
  // The map gives Kosovo no id; the offline database uses the unofficial XK.
  return name === "Kosovo" ? "XK" : null;
}

/** A country code in the form it is stored: two capital letters. */
export const COUNTRY_CODE = /^[A-Z]{2}$/;

const names = new Intl.DisplayNames(["en"], { type: "region" });

/** "France" for "FR". A code the platform does not know is shown as the code. */
export function countryName(code: string): string {
  if (code === "XK") return "Kosovo";
  try {
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}
