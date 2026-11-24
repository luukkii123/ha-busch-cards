"use strict";

// subscribeMessage stand-in for `schedule/subscribe` and `calendar/event/subscribe` on a kit hass (#1326, M12/M39).
// It keeps the kit's own subscribeMessage (counters, behave/behaveOnce, reconnect) and adds what HA 2026.11.1 does
// after the subscribe result:
//   schedule/subscribe          one event with every stored plan as `added` (helpers/collection.py `_ws_subscribe`),
//                               later `added`/`updated`/`removed` changes with `schedule_id` and `item`.
//   calendar/event/subscribe    one event `{ events: [...] }` for this subscriber (calendar/__init__.py), events in
//                               `CalendarEvent.as_dict()` form: plain `start`/`end` strings and `all_day`.
// `schedule()` returns the stored plans, `calendar(entity, start, end)` the events in the REST form (start.dateTime/date),
// or null for HA's `events: null` (the calendar could not be read).
// `unknownCommand(ha, type)` makes the kit answer a subscribe like an HA without that command (REST/list fallback).

/** REST form (`calendars/<entity>`) to the websocket form of `CalendarEvent.as_dict()`. */
function wsEvent(event) {
  const out = {};
  for (const [key, value] of Object.entries(event)) {
    if (value && typeof value === "object" && ("dateTime" in value || "date" in value)) out[key] = value.dateTime || value.date;
    else if (value != null) out[key] = String(value);
  }
  out.all_day = Boolean(event.start && event.start.date && !event.start.dateTime);
  return out;
}

function installSubscriptions(ha, { schedule = null, calendar = null } = {}) {
  const connection = ha.connection;
  const original = connection.subscribeMessage.bind(connection);
  const live = new Set();
  connection.subscribeMessage = (callback, message, options) => original(callback, message, options).then((unsubscribe) => {
    const sub = { callback, message, options };
    live.add(sub);
    Promise.resolve().then(() => {
      if (!live.has(sub)) return;
      if (message.type === "schedule/subscribe" && schedule) {
        callback(JSON.parse(JSON.stringify(schedule())).map((item) => ({ change_type: "added", schedule_id: item.id, item })));
      } else if (message.type === "calendar/event/subscribe" && calendar) {
        const list = calendar(message.entity_id, message.start, message.end);
        callback({ events: list === null ? null : list.map(wsEvent) });
      }
    });
    return () => { live.delete(sub); return unsubscribe(); };
  });
  const of = (type) => [...live].filter((sub) => sub.message.type === type);
  return {
    /** Live subscriptions of `type` (after unsubscribe they are gone). */
    active: (type) => of(type).map((sub) => sub.message),
    /** Options passed to subscribeMessage (`resubscribe`). */
    options: (type) => of(type).map((sub) => sub.options),
    /** Sends a schedule change (`added`, `updated`, `removed`) to every schedule subscriber. */
    pushSchedule(changeType, item) {
      for (const sub of of("schedule/subscribe")) sub.callback([{ change_type: changeType, schedule_id: item.id, item: JSON.parse(JSON.stringify(item)) }]);
    },
    /** Re-sends the events of `entity` to its subscribers, like HA after the entity wrote its state. */
    pushCalendar(entity, events) {
      for (const sub of of("calendar/event/subscribe")) {
        if (sub.message.entity_id !== entity) continue;
        const list = events === undefined ? calendar(entity, sub.message.start, sub.message.end) : events;
        sub.callback({ events: list === null ? null : list.map(wsEvent) });
      }
    },
  };
}

function unknownCommand(ha, type) {
  ha.behave(type, { reject: Object.assign(new Error("Unknown command."), { code: "unknown_command" }) });
  return ha;
}

module.exports = { installSubscriptions, unknownCommand, wsEvent };
