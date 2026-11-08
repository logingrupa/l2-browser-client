# Optional browser composition fixtures

These fixtures describe the recovered submission sequence. They do not authorize a renderer migration or claim visible parity. Use them as inputs to an ordered reference, then compare a proposed browser composition against that reference under separately established sampling and blend state. A browser implementation need not reproduce the native draw batching.

| Fixture | Required observation | Distinguishes |
| --- | --- | --- |
| Shared edge at X88, Y227..228 | Source triangle `955,1004,1005` has `[0]`; neighbor `954,955,1004` has `[0,6]`. | Applying one layer list to the whole mapped region would lose the observed geometry-dependent subsets. |
| Shared edge at X65, Y246..247 | `1863,1912,1913` has `[0,1,2]`; neighbor `1862,1863,1912` has `[0,1,2,6]`. | Layer 1 retention does not imply layer 6 retention. |
| Sparse overlay | `1831,1832,1881` has `[0,7]`. | Later authored layers can appear while intermediate layers are omitted in the submission. |
| Seven-layer order | `926,927,976` has `[0,2,3,4,5,6,7]`. | A material or texture sort must preserve the observed order for overlapping geometry. |
| Split layer 6 groups | Draws 142250 and 142255 have 900 and 300 selected triangles, with no overlap. | Two draws using one source layer do not mean two contributions to every selected triangle. |
| Scope guard | Source rows Y208..223 are not mapped by this vertex upload. | Unmapped geometry must remain unknown in this fixture. |

The two triangles in each of the 1,488 covered cells share their layer sequence. This is a measured property of the retained submission, not a general terrain-pruning rule. Preserve exact indices in a fixture rather than deriving retention from sampled mask alpha or bUseAlpha.

No pixel expectation is supplied here. The first-device clip limitation prevents these submissions from serving as a visible composition oracle. Audio acceptance also remains unresolved and separate.
