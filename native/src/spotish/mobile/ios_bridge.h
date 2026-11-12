// SPDX-License-Identifier: GPL-3.0-only
#include <stdbool.h>
#include <stdint.h>

typedef void (*MSPReply)(uint64_t request_id, bool success, const char *value);
typedef void (*MSPEvent)(const char *snapshot);

void metrolist_spotify_ios_request(uint64_t request_id, const char *method,
                                 const char *payload, MSPReply reply, MSPEvent event);
