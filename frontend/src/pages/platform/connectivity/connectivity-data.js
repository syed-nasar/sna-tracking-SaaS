import { useEffect, useState } from "react";
import { platformApi } from "../../../services/api";

export const root = "/platform/connectivity";
export const lifecycleOptions = ["available", "reserved", "active", "suspended", "faulty", "retired"];
export const labelOptions = (values) => values.map((value) => [value, value[0].toUpperCase() + value.slice(1)]);

export function message(error, fallback) {
  return error.response?.data?.message || fallback;
}

export function day(value) {
  return value ? `${value.slice(0, 10)} UTC` : "Unrecorded";
}

export function useConnectivityGet(path, params, revision = 0) {
  const [result, setResult] = useState({ data: null, error: "", key: null });
  const key = path ? JSON.stringify([path, params, revision]) : null;

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const [url, config] = JSON.parse(key);
    platformApi.get(root + url, { params: config, signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setResult({ data, error: "", key }); })
      .catch((error) => {
        if (!controller.signal.aborted) setResult({ data: null, error: message(error, "Could not load connectivity data."), key });
      });
    return () => controller.abort();
  }, [key]);

  return result.key === key ? result : { data: null, error: "" };
}
