/**
 * Words the Flow page says that the runner has to recognise.
 *
 * One constant, imported by the page that says it and the runner that reads
 * it, so the sentence cannot be reworded on one side only. Reading state out
 * of prose is fragile; reading it out of prose two files define separately is
 * how it breaks without anyone noticing.
 */

/** A style reference searched for by name and not found in Flow's library. */
export const LIBRARY_MISS = 'nothing in the library matches';
