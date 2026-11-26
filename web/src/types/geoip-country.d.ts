declare module "geoip-country" {
  /** Country only: this package ships no city, region or coordinate data. */
  export function lookup(ip: string): { country: string } | null;
  const geoip: { lookup: typeof lookup };
  export default geoip;
}
