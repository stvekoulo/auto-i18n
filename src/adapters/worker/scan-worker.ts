/**
 * Point d'entrée d'un worker de scan.
 *
 * Boucle passive : reçoit un lot de fichiers, les scanne, renvoie les
 * résultats, puis attend le lot suivant. Le thread principal pilote le rythme,
 * puisque c'est lui qui sait combien de travail reste.
 */

import { parentPort } from 'node:worker_threads';
import { scanOneFile } from './scan-file.js';
import type { ScanRequest, ScanResponse } from './protocol.js';

if (parentPort) {
  const port = parentPort;
  port.on('message', (request: ScanRequest) => {
    void Promise.all(request.files.map(file => scanOneFile(file, request.blacklist))).then(
      outcomes => port.postMessage({ outcomes } satisfies ScanResponse),
    );
  });
}
