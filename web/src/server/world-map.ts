import type { Feature, FeatureCollection, Geometry } from "geojson";
import { feature } from "topojson-client";
import atlas from "world-atlas/countries-110m.json";
import { codeForShape } from "@/lib/world-codes";

/**
 * The country shapes for the visitor map, as GeoJSON for the Bklit choropleth chart: Natural
 * Earth countries (public domain) from the world-atlas package (ISC). Antarctica is left out.
 * Each feature carries its two-letter `code` (null for Somaliland and Northern Cyprus, which have
 * none and can never carry data). Coordinates are rounded to two decimals to keep the page small.
 */

export type CountryProperties = { name: string; id?: string | number; code: string | null };
export type CountryCollection = FeatureCollection<Geometry, CountryProperties>;

const round = (n: number) => Math.round(n * 100) / 100;
function roundCoords(c: unknown): unknown {
  return Array.isArray(c) ? (typeof c[0] === "number" ? c.map((n: number) => round(n)) : c.map(roundCoords)) : c;
}

let shapes: CountryCollection | null = null;

export function worldShapes(): CountryCollection {
  if (shapes) return shapes;
  const topology = atlas as unknown as Parameters<typeof feature>[0];
  const objects = (topology as unknown as { objects: { countries: Parameters<typeof feature>[1] } }).objects;
  const collection = feature(topology, objects.countries) as unknown as FeatureCollection<Geometry, { name: string }>;
  shapes = {
    type: "FeatureCollection",
    features: collection.features
      .filter((f) => String(f.id) !== "010")
      .map((f): Feature<Geometry, CountryProperties> => ({
        type: "Feature",
        id: f.id,
        properties: { name: f.properties.name, id: f.id, code: codeForShape(f.id, f.properties.name) },
        geometry: { ...f.geometry, coordinates: roundCoords((f.geometry as { coordinates: unknown }).coordinates) } as Geometry,
      })),
  };
  return shapes;
}
