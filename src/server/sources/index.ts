import type { SourceDefinition } from "./types.ts";
import { ch4Source, co2Source } from "./atmosphere.ts";
import { climateLawsSource, copsSource, disasterAlertsSource, wwaStudiesSource } from "./events.ts";
import { carbonMajorsSource, igccSource, ndcTargetsSource, subsidiesSource } from "./policy.ts";
import { countriesSource } from "./geo.ts";
import {
  berkeleyEarthSource,
  co2IceCoreSource,
  ensoSource,
  paleoTemperatureSource,
  seaLevelLongSource,
  volcanoesSource,
} from "./history.ts";
import { facilitiesSource, firesSource, naturalEventsSource } from "./live.ts";
import { oceanHeatSource, seaIceSource, seaLevelSource } from "./ocean-ice.ts";
import { owidCo2Source, owidEnergySource, treeCoverLossSource } from "./owid.ts";
import { era5DailySource, gistempSource, temperatureSource } from "./temperature.ts";

/** Every upstream the server knows about. Add a source here and it gets cached and scheduled. */
export const sources: SourceDefinition<unknown>[] = [
  co2Source,
  ch4Source,
  temperatureSource,
  gistempSource,
  era5DailySource,
  seaIceSource,
  seaLevelSource,
  oceanHeatSource,
  owidCo2Source,
  owidEnergySource,
  treeCoverLossSource,
  firesSource,
  naturalEventsSource,
  facilitiesSource,
  countriesSource,
  wwaStudiesSource,
  copsSource,
  climateLawsSource,
  disasterAlertsSource,
  igccSource,
  ndcTargetsSource,
  subsidiesSource,
  carbonMajorsSource,
  co2IceCoreSource,
  paleoTemperatureSource,
  berkeleyEarthSource,
  seaLevelLongSource,
  ensoSource,
  volcanoesSource,
] as SourceDefinition<unknown>[];
