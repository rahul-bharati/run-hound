/**
 * The pipeline's breakpoint (DESIGN.md §2.1, §4.3): from 1024 px the steps sit in 5 columns and the connectors run
 * across; below, down. Its own module, so the scroll runtime's shell (which finishes the pipeline when it changes)
 * doesn't carry the pipeline's builder.
 */
export const pipelineDesktopQuery = "(min-width: 64rem)";
