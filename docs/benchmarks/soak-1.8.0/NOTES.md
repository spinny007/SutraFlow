# Reading the 1.8.0 soak report

8 hours on one machine (a studio and two engines, PostgreSQL on the same machine), 500,338 requests,
0.089% failed with both fault windows included. 27 of 31 checks passed. The four that failed:

| Check | Why | Done |
|---|---|---|
| No engine stopped by itself | When the database came back after the 20-second cut, the studio stopped: a trigger started a run while the database was gone and nobody caught the failed start (an unhandled promise rejection ends Node). It started again at once. | Fixed after the run: triggers catch a failed start (shown on the listener), and the server logs any unhandled rejection instead of stopping. |
| Timer kept time (2,498 of 2,880) | The computer went into standby twice (12:46-13:11 and 16:33-17:12 IST): 382 missed ticks match the 64 minutes paused. | The soak now records standby as an event and leaves those minutes out of its delay figures. |
| Engine 1 memory (61 MB per hour) | 345 runs piled up waiting for an approval that the soak never gave (a bug in the soak tool: it looked for a field the approvals list does not have). Waiting runs are kept, so memory and the approvals list grew with them. | Soak tool fixed (it now finds the approval by its wait). |
| Channel publish as fast (529 to 1,110 ms) | Channel, error handler and RAG search runs are started through the studio's admin API, which was also answering the soak's growing approvals list every 2 seconds. Calls through the gateway (REST, SOAP, WebSocket, MCP) stayed as fast. | Same fix as above. |

The "longest single wait" of 2,327,872 ms on every engine is the 38-minute standby, not the engines.

Files: 22 CSVs of 10 to 60 MB through a watched folder, 14 over SFTP and 14 over FTP, all streamed with
every row counted; 7 documents of 10 to 50 MB learned into pgvector (328,490 passages, 14 to 75 s each).
Google Drive was not part of this run (no account set up when it started).
