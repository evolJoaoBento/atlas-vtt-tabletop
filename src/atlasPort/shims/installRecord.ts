// Stand-in for Atlas's services/collectionBundle/installRecord.ts @ 0.15.0 (AGPL-3.0): only the folder the copies need.
import { ATLAS_VTT_DIR } from '../app/services/assetPaths';

/** Hidden and device-local: import backups and the index cache, which no sync tool should carry. */
export const COLLECTION_DATA_DIR = `${ATLAS_VTT_DIR}/.atlas-data`;
