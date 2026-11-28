import type { Citation } from "@shared/types.ts";

/**
 * Passages of the IPCC Sixth Assessment Report (Working Group I, Summary for
 * Policymakers) that the story notes rest on. This is the only hand-written
 * content behind the notes: each quote is copied verbatim from the report
 * (footnote markers dropped; "…" marks an omission, [Footnote n: …] a
 * footnote's text), and the plain-language lines in insights.ts may only
 * restate what their quote says, with every number taken from it.
 */

const SPM = "https://www.ipcc.ch/report/ar6/wg1/downloads/report/IPCC_AR6_WGI_SPM.pdf";

const spm = (paragraph: string, page: number, quote: string): Citation => ({
  label: `IPCC AR6 WG1 Summary for Policymakers, ${paragraph}`,
  url: `${SPM}#page=${page}`,
  quote,
});

export const IPCC = {
  humanCausedCo2: spm(
    "A.1.1",
    4,
    "Observed increases in well-mixed greenhouse gas (GHG) concentrations since around 1750 are unequivocally caused by human activities. … Land and ocean have taken up a near-constant proportion (globally about 56% per year) of CO2 emissions from human activities over the past six decades, with regional differences (high confidence).",
  ),
  landVsOcean: spm(
    "A.1.2",
    5,
    "Global surface temperature was 1.09 [0.95 to 1.20] °C higher in 2011–2020 than 1850–1900, with larger increases over land (1.59 [1.34 to 1.83] °C) than over the ocean (0.88 [0.68 to 1.01] °C).",
  ),
  humanCausedWarming: spm(
    "A.1.3",
    5,
    "The likely range of total human-caused global surface temperature increase from 1850–1900 to 2010–2019 is 0.8°C to 1.3°C, with a best estimate of 1.07°C. It is likely that well-mixed GHGs contributed a warming of 1.0°C to 2.0°C, other human drivers (principally aerosols) contributed a cooling of 0.0°C to 0.8°C, natural drivers changed global surface temperature by –0.1°C to +0.1°C, and internal variability changed it by –0.2°C to +0.2°C.",
  ),
  arcticIceHuman: spm(
    "A.1.5",
    5,
    "Human influence is very likely the main driver of the global retreat of glaciers since the 1990s and the decrease in Arctic sea ice area between 1979–1988 and 2010–2019 (decreases of about 40% in September and about 10% in March). There has been no significant trend in Antarctic sea ice area from 1979 to 2020 due to regionally opposing trends and large internal variability.",
  ),
  oceanWarmingHuman: spm(
    "A.1.6",
    5,
    "It is virtually certain that the global upper ocean (0–700 m) has warmed since the 1970s and extremely likely that human influence is the main driver. It is virtually certain that human-caused CO2 emissions are the main driver of current global acidification of the surface open ocean.",
  ),
  seaLevelRates: spm(
    "A.1.7",
    5,
    "Global mean sea level increased by 0.20 [0.15 to 0.25] m between 1901 and 2018. The average rate of sea level rise was 1.3 [0.6 to 2.1] mm yr–1 between 1901 and 1971, increasing to 1.9 [0.8 to 2.9] mm yr–1 between 1971 and 2006, and further increasing to 3.7 [3.2 to 4.2] mm yr–1 between 2006 and 2018 (high confidence). Human influence was very likely the main driver of these increases since at least 1971.",
  ),
  co2TwoMillionYears: spm(
    "A.2.1",
    8,
    "In 2019, atmospheric CO2 concentrations were higher than at any time in at least 2 million years (high confidence), and concentrations of CH4 and N2O were higher than at any time in at least 800,000 years (very high confidence). Since 1750, increases in CO2 (47%) and CH4 (156%) concentrations far exceed – and increases in N2O (23%) are similar to – the natural multi-millennial changes between glacial and interglacial periods over at least the past 800,000 years (very high confidence).",
  ),
  fastestIn2000Years: spm(
    "A.2.2",
    8,
    "Global surface temperature has increased faster since 1970 than in any other 50-year period over at least the last 2000 years (high confidence).",
  ),
  arcticIce1000Years: spm(
    "A.2.3",
    8,
    "In 2011–2020, annual average Arctic sea ice area reached its lowest level since at least 1850 (high confidence). Late summer Arctic sea ice area was smaller than at any time in at least the past 1000 years (medium confidence).",
  ),
  seaLevel3000Years: spm(
    "A.2.4",
    8,
    "Global mean sea level has risen faster since 1900 than over any preceding century in at least the last 3000 years (high confidence).",
  ),
  hotExtremes: spm(
    "A.3.1",
    8,
    "It is virtually certain that hot extremes (including heatwaves) have become more frequent and more intense across most land regions since the 1950s, while cold extremes (including cold waves) have become less frequent and less severe, with high confidence that human-induced climate change is the main driver of these changes. … Marine heatwaves have approximately doubled in frequency since the 1980s (high confidence), and human influence has very likely contributed to most of them since at least 2006.",
  ),
  oceanTakesTheHeat: spm(
    "A.4.2",
    11,
    "Ocean warming accounted for 91% of the heating in the climate system, with land warming, ice loss and atmospheric warming accounting for about 5%, 3% and 1%, respectively (high confidence).",
  ),
  seaLevelCauses: spm(
    "A.4.3",
    11,
    "Heating of the climate system has caused global mean sea level rise through ice loss on land and thermal expansion from ocean warming. Thermal expansion explained 50% of sea level rise during 1971–2018, while ice loss from glaciers contributed 22%, ice sheets 20% and changes in land-water storage 8%.",
  ),
  twentyYearAverages: spm("footnote 24", 14, "Changes in global surface temperature are reported as running 20-year averages, unless stated otherwise."),
  extremesPerHalfDegree: spm(
    "B.2.2",
    15,
    "With every additional increment of global warming, changes in extremes continue to become larger. For example, every additional 0.5°C of global warming causes clearly discernible increases in the intensity and frequency of hot extremes, including heatwaves (very likely), and heavy precipitation (high confidence), as well as agricultural and ecological droughts in some regions (high confidence).",
  ),
  iceFreeArctic: spm(
    "B.2.5",
    16,
    "The Arctic is likely to be practically sea ice-free in September at least once before 2050 under the five illustrative scenarios considered in this report, with more frequent occurrences for higher warming levels. [Footnote 31: Monthly average sea ice area of less than 1 million km2, which is about 15% of the average September sea ice area observed in 1979–1988.]",
  ),
  oceanCommitted: spm(
    "B.5.1",
    21,
    "Past GHG emissions since 1750 have committed the global ocean to future warming (high confidence). … Changes are irreversible on centennial to millennial time scales in global ocean temperature (very high confidence), deep-ocean acidification (very high confidence) and deoxygenation (medium confidence).",
  ),
  seaLevelCommitted: spm(
    "B.5.4",
    21,
    "In the longer term, sea level is committed to rise for centuries to millennia due to continuing deep-ocean warming and ice-sheet melt and will remain elevated for thousands of years (high confidence). Over the next 2000 years, global mean sea level will rise by about 2 to 3 m if warming is limited to 1.5°C, 2 to 6 m if limited to 2°C and 19 to 22 m with 5°C of warming, and it will continue to rise over subsequent millennia (low confidence).",
  ),
  netZero: spm(
    "D.1",
    27,
    "From a physical science perspective, limiting human-induced global warming to a specific level requires limiting cumulative CO2 emissions, reaching at least net zero CO2 emissions, along with strong reductions in other greenhouse gas emissions.",
  ),
  warmingPerTonne: spm(
    "D.1.1",
    28,
    "This Report reaffirms with high confidence the AR5 finding that there is a near-linear relationship between cumulative anthropogenic CO2 emissions and the global warming they cause. Each 1000 GtCO2 of cumulative CO2 emissions is assessed to likely cause a 0.27°C to 0.63°C increase in global surface temperature with a best estimate of 0.45°C.",
  ),
} satisfies Record<string, Citation>;
