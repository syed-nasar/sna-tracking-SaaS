
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  CircleAlert,
  Clock3,
  Crosshair,
  Layers,
  MapPin,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Truck,
  Users,
} from "lucide-react";

import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";

import "leaflet/dist/leaflet.css";

import { useAuth } from "../context/AuthContext";
import TenantLayout from "../components/TenantLayout";
import FleetGroupFilter from "../components/FleetGroupFilter";
import { PageHeader, SearchField, StateNotice, StatusBadge } from "../components/WorkspaceUi";
import { tenantApi } from "../services/api";

const DEFAULT_CENTER = [24.8607, 67.0011];
const REFRESH_INTERVAL = 15000;

const STREET_TILES =
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

const SATELLITE_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

function validCoordinates(position) {
  return (
    position &&
    typeof position.latitude === "number" &&
    typeof position.longitude === "number" &&
    Number.isFinite(position.latitude) &&
    Number.isFinite(position.longitude) &&
    Math.abs(position.latitude) <= 90 &&
    Math.abs(position.longitude) <= 180
  );
}

function formatTime(value) {
  if (!value) return "Not available";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "Not available"
    : date.toLocaleString();
}

function formatSpeed(position) {
  if (typeof position?.speed !== "number") {
    return "—";
  }

  // Traccar reports speed in knots.
  return `${(position.speed * 1.852).toFixed(1)} km/h`;
}

function getVehicleName(vehicle) {
  return vehicle.name || `Vehicle ${vehicle.id}`;
}

function getVehicleModel(vehicle) {
  return (
    [vehicle.make, vehicle.model]
      .filter(Boolean)
      .join(" ") || "Model not specified"
  );
}

/*
 * Shared authenticated image component.
 *
 * Vehicle images require an Authorization Bearer token.
 * Images are downloaded through tenantApi and converted
 * to temporary browser object URLs.
 *
 * Image loading depends on the image URL, not GPS data,
 * so position refreshes do not repeatedly download
 * unchanged vehicle images.
 */
function VehicleImage({
  vehicleId,
  imageUrl,
  className = "",
  iconSize = 22,
  alt = "Vehicle image",
}) {
  const [imageState, setImageState] = useState({
    key: null,
    source: null,
  });

  const imageKey = imageUrl
    ? `${vehicleId}:${imageUrl}`
    : null;

  useEffect(() => {
    if (!imageKey) {
      return undefined;
    }

    let cancelled = false;
    let objectUrl = null;

    async function loadImage() {
      try {
        const response = await tenantApi.get(
          `/vehicles/${vehicleId}/image`,
          {
            responseType: "blob",
          }
        );

        if (cancelled) return;

        objectUrl = URL.createObjectURL(response.data);

        setImageState({
          key: imageKey,
          source: objectUrl,
        });
      } catch (error) {
        if (!cancelled) {
          console.error(
            `Unable to load image for vehicle ${vehicleId}:`,
            error.message
          );

          setImageState({
            key: imageKey,
            source: null,
          });
        }
      }
    }

    loadImage();

    return () => {
      cancelled = true;

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [vehicleId, imageUrl, imageKey]);

  const source =
    imageState.key === imageKey
      ? imageState.source
      : null;

  if (!source) {
    return (
      <div
        className={`flex items-center justify-center bg-accent-soft text-accent ${className}`}
      >
        <Truck size={iconSize} />
      </div>
    );
  }

  return (
    <img
      src={source}
      alt={alt}
      className={`object-cover ${className}`}
    />
  );
}

function GpsStatusBadge({ status }) {
  const normalized = String(
    status || "unknown"
  ).toLowerCase();

  return <StatusBadge tone={normalized === "online" ? "positive" : normalized === "offline" ? "caution" : "neutral"}>{normalized}</StatusBadge>;
}

function motionStatus(vehicle) {
  if (vehicle.gpsStatus === "offline") return ["Offline", "caution"];
  const position = vehicle.position;
  const fix = Date.parse(position?.fixTime ?? position?.deviceTime);
  const elapsed = Date.now() - fix;
  if (vehicle.gpsStatus !== "online" || !validCoordinates(position) || position.valid === false ||
      !Number.isFinite(fix) || elapsed < 0 || elapsed > 120_000) return ["Unknown", "neutral"];

  const { motion, ignition } = position.attributes ?? {};
  const { speed } = position;
  if (motion === true || (Number.isFinite(speed) && speed > 0)) return ["Moving", "positive"];
  if (motion === false || speed === 0) return ignition === true ? ["Idle", "caution"] : ["Stopped", "accent"];
  return ["Unknown", "neutral"];
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function fitVehicleBounds(map, locatedVehicles) {
  if (locatedVehicles.length === 0) {
    return;
  }

  if (locatedVehicles.length === 1) {
    const position = locatedVehicles[0].position;

    const point = [position.latitude, position.longitude];
    if (prefersReducedMotion()) map.setView(point, 15, { animate: false });
    else map.flyTo(point, 15, { duration: 0.8 });

    return;
  }

  const bounds = locatedVehicles.map(
    (vehicle) => [
      vehicle.position.latitude,
      vehicle.position.longitude,
    ]
  );

  const options = {
    padding: [60, 60],
    maxZoom: 15,
    duration: 0.8,
  };
  if (prefersReducedMotion()) map.fitBounds(bounds, { ...options, animate: false });
  else map.flyToBounds(bounds, options);
}

function MapController({
  locatedVehicles,
  selectedVehicle,
  focusRequest,
  showAllRequest,
}) {
  const map = useMap();

  const initialized = useRef(false);
  const lastFocusRequest = useRef(0);
  const lastShowAllRequest = useRef(0);

  useEffect(() => {
    const resize = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    resize.observe(map.getContainer());
    return () => resize.disconnect();
  }, [map]);

  useEffect(() => {
    if (
      initialized.current ||
      locatedVehicles.length === 0
    ) {
      return;
    }

    initialized.current = true;

    if (locatedVehicles.length === 1) {
      const position = locatedVehicles[0].position;

      map.setView(
        [position.latitude, position.longitude],
        14
      );

      return;
    }

    const bounds = locatedVehicles.map(
      (vehicle) => [
        vehicle.position.latitude,
        vehicle.position.longitude,
      ]
    );

    map.fitBounds(bounds, {
      padding: [60, 60],
      maxZoom: 15,
    });
  }, [map, locatedVehicles]);

  useEffect(() => {
    if (
      focusRequest === 0 ||
      focusRequest === lastFocusRequest.current
    ) {
      return;
    }

    lastFocusRequest.current = focusRequest;

    if (!validCoordinates(selectedVehicle?.position)) {
      return;
    }

    const point = [selectedVehicle.position.latitude, selectedVehicle.position.longitude];
    if (prefersReducedMotion()) map.setView(point, 16, { animate: false });
    else map.flyTo(point, 16, { duration: 0.8 });
  }, [map, selectedVehicle, focusRequest]);

  useEffect(() => {
    if (
      showAllRequest === 0 ||
      showAllRequest === lastShowAllRequest.current
    ) {
      return;
    }

    lastShowAllRequest.current = showAllRequest;

    fitVehicleBounds(map, locatedVehicles);
  }, [map, locatedVehicles, showAllRequest]);

  return null;
}

function VehicleListItem({
  vehicle,
  selected,
  onSelect,
}) {
  const [motion, tone] = motionStatus(vehicle);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`mb-2 w-full rounded-xl border p-3 text-left transition ${
        selected
          ? "border-accent-line bg-accent-soft"
          : "border-line bg-hover hover:bg-hover"
      }`}
    >
      <div className="flex items-start gap-3">
        <VehicleImage
          vehicleId={vehicle.id}
          imageUrl={vehicle.imageUrl}
          className="h-12 w-14 shrink-0 rounded-lg"
          alt={getVehicleName(vehicle)}
        />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">
            {getVehicleName(vehicle)}
          </p>

          <p className="mt-1 truncate text-xs text-muted">
            {vehicle.registrationNumber ||
              "No registration"}
          </p>

          <p className="mt-1 truncate text-[11px] text-subtle">
            {getVehicleModel(vehicle)}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          <GpsStatusBadge status={vehicle.gpsStatus} />
          {vehicle.gpsStatus === "online" && <StatusBadge tone={tone}>{motion === "Unknown" ? "Motion unknown" : motion}</StatusBadge>}
        </div>

        <span className="text-[11px] text-muted">
          {validCoordinates(vehicle.position)
            ? formatSpeed(vehicle.position)
            : "No GPS position"}
        </span>
      </div>
      {vehicle.position && <p className="mt-1 text-xs text-muted">
        Last fix {formatTime(vehicle.position.fixTime ?? vehicle.position.deviceTime)}
      </p>}
    </button>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line pb-3 text-sm">
      <span className="text-subtle">
        {label}
      </span>

      <span className="text-right font-medium text-ink">
        {value}
      </span>
    </div>
  );
}

function SelectedVehicleDetails({ vehicle, showOperations, positionError }) {
  if (!vehicle) {
    return null;
  }

  const hasPosition = validCoordinates(vehicle.position);
  const [motion, tone] = motionStatus(vehicle);

  return (
    <section className="mt-5 overflow-hidden rounded-panel border border-line bg-panel">
      <div className="border-b border-line px-5 py-4">
        <h3 className="font-bold">
          Selected Vehicle
        </h3>
      </div>

      <div className="p-5">
        <VehicleImage
          vehicleId={vehicle.id}
          imageUrl={vehicle.imageUrl}
          className="h-44 w-full rounded-xl"
          iconSize={45}
          alt={getVehicleName(vehicle)}
        />

        <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="text-lg font-semibold">
              {getVehicleName(vehicle)}
            </h4>

            <p className="mt-1 text-sm text-muted">
              {getVehicleModel(vehicle)}
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5"><GpsStatusBadge status={vehicle.gpsStatus} />
            {vehicle.gpsStatus === "online" && <StatusBadge tone={tone}>{motion === "Unknown" ? "Motion unknown" : motion}</StatusBadge>}
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <DetailRow
            label="Registration"
            value={
              vehicle.registrationNumber ||
              "Not specified"
            }
          />

          <DetailRow
            label="GPS Device"
            value={vehicle.traccarDeviceId ? `#${vehicle.traccarDeviceId}` : "Not installed"}
          />

          <DetailRow
            label="Vehicle Status"
            value={vehicle.status || "unknown"}
          />

          {showOperations && (
            <>
              <DetailRow label="Group" value={vehicle.groupName || "Ungrouped"} />
              <DetailRow label="Driver" value={vehicle.driverName || "Unassigned"} />
              <DetailRow label="Fleet number" value={vehicle.fleetNumber || "Unspecified"} />
            </>
          )}

          <DetailRow
            label="Last Reported Speed"
            value={
              hasPosition
                ? formatSpeed(vehicle.position)
                : "Not available"
            }
          />

          <DetailRow
            label="Last Reported"
            value={
              hasPosition
                ? formatTime(
                    vehicle.position.deviceTime ||
                      vehicle.position.fixTime
                  )
                : "Not available"
            }
          />
        </div>

        {!hasPosition && (
          <p className="mt-4 rounded-xl border border-caution-line bg-caution-soft p-3 text-xs text-caution">
            {positionError || "This vehicle has no reported GPS coordinates yet."}
          </p>
        )}
      </div>
    </section>
  );
}

function VehicleMapPopup({ vehicle }) {
  return (
    <div className="w-[220px]">
      <VehicleImage
        vehicleId={vehicle.id}
        imageUrl={vehicle.imageUrl}
        className="mb-3 h-28 w-full rounded-lg"
        iconSize={34}
        alt={getVehicleName(vehicle)}
      />

      <h4 className="text-sm font-bold text-subtle">
        {getVehicleName(vehicle)}
      </h4>

      <p className="mt-1 text-xs text-subtle">
        {getVehicleModel(vehicle)}
      </p>

      <div className="mt-3 space-y-1.5 text-xs text-subtle">
        <p>
          <strong>Registration:</strong>{" "}
          {vehicle.registrationNumber ||
            "Not specified"}
        </p>

        <p>
          <strong>GPS Status:</strong>{" "}
          {vehicle.gpsStatus || "unknown"}
        </p>

        <p>
          <strong>Speed:</strong>{" "}
          {formatSpeed(vehicle.position)}
        </p>

        <p>
          <strong>Last Reported:</strong>{" "}
          {formatTime(
            vehicle.position.deviceTime ||
              vehicle.position.fixTime
          )}
        </p>
      </div>
    </div>
  );
}

function VehicleMarker({ vehicle, selected, onSelect }) {
  const marker = useRef(null);
  const [, tone] = motionStatus(vehicle);
  const name = getVehicleName(vehicle);
  useEffect(() => {
    const element = marker.current?.getElement();
    if (!element) return;
    element.setAttribute("tabindex", "0");
    element.setAttribute("role", "button");
    element.setAttribute("aria-label", `Select ${name} on map`);
    element.setAttribute("aria-pressed", String(selected));
    const activate = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        onSelect(vehicle);
      }
    };
    element.addEventListener("keydown", activate);
    return () => element.removeEventListener("keydown", activate);
  }, [name, onSelect, selected, vehicle]);

  return <CircleMarker ref={marker} center={[vehicle.position.latitude, vehicle.position.longitude]}
    radius={selected ? 11 : 8} pathOptions={{
      color: "var(--ui-panel)", fillColor: `var(--ui-${tone === "neutral" ? "muted" : tone})`,
      weight: selected ? 4 : 2, fillOpacity: 0.95,
    }} eventHandlers={{ click: () => onSelect(vehicle) }}>
    <Tooltip direction="top">{name}</Tooltip>
    <Popup><VehicleMapPopup vehicle={vehicle} /></Popup>
  </CircleMarker>;
}

export default function LiveTrackingPage() {
  const { session } = useAuth();
  const profile = session?.profile;

  const isPersonal = profile?.customerType === "personal";
  const isBusiness = profile?.customerType === "business";

  const labels = isPersonal
    ? {
        layoutTitle: "My Tracking",
        eyebrow: "Personal Vehicle Tracking",
        heading: "My Vehicle Tracking",
        description:
          "Track your vehicles, view their photos, and monitor their latest reported GPS locations.",
        totalVehicles: "My Vehicles",
        vehicleList: "My Vehicles",
        mapTitle: "My Vehicles on Map",
        searchPlaceholder: "Search my vehicles...",
        emptyVehicles:
          "No vehicles available for tracking yet. Contact SNA Technologies to register your first vehicle.",
        noSearchResults:
          "No vehicles match your search.",
        noPositions:
          "No GPS positions available yet. Your vehicles will appear when their trackers report coordinates.",
      }
    : {
        layoutTitle: "Live Fleet Tracking",
        eyebrow: "Fleet Operations",
        heading: "Live Fleet Tracking",
        description:
          "Monitor your company's vehicles, images, and latest reported GPS locations.",
        totalVehicles: "Total Vehicles",
        vehicleList: "Fleet Vehicles",
        mapTitle: "Fleet Tracking Map",
        searchPlaceholder: "Search fleet vehicles...",
        emptyVehicles:
          "No fleet vehicles available for tracking yet.",
        noSearchResults:
          "No fleet vehicles match your search.",
        noPositions:
          "No GPS positions available yet. Fleet vehicles will appear when their trackers report coordinates.",
      };

  const [vehicles, setVehicles] = useState([]);
  const [positions, setPositions] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [gpsFilter, setGpsFilter] = useState("");
  const [positionFilter, setPositionFilter] = useState("");
  const [positionError, setPositionError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [mapType, setMapType] = useState("street");
  const [focusRequest, setFocusRequest] = useState(0);
  const [showAllRequest, setShowAllRequest] = useState(0);
  const [listOpen, setListOpen] = useState(true);

  const requestInProgress = useRef(false);

  const loadTracking = useCallback(
    async (initial = false) => {
      if (requestInProgress.current) {
        return;
      }

      requestInProgress.current = true;

      if (initial) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      setError("");

      try {
        const response = await tenantApi.get("/vehicles");

        if (!Array.isArray(response.data)) {
          throw new Error(
            "Unexpected vehicles API response"
          );
        }

        const tenantVehicles = response.data;
        const nextPositions = {};

        setVehicles(tenantVehicles);
        try {
          const result = await tenantApi.get("/vehicles/positions");
          for (const { vehicleId, position } of result.data) {
            if (validCoordinates(position)) nextPositions[String(vehicleId)] = position;
          }
          setPositions(nextPositions);
          setPositionError("");
        } catch {
          setPositions({});
          setPositionError("GPS positions are temporarily unavailable.");
        }
      } catch (requestError) {
        setError(
          requestError.response?.data?.message ||
            requestError.message ||
            "Unable to load live tracking"
        );
      } finally {
        requestInProgress.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    loadTracking(true);

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        loadTracking();
      }
    }, REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, [loadTracking]);

  const trackedVehicles = useMemo(
    () =>
      vehicles.map((vehicle) => ({
        ...vehicle,
        position:
          positions[String(vehicle.id)] || null,
      })),
    [vehicles, positions]
  );

  const allLocatedVehicles = useMemo(
    () =>
      trackedVehicles.filter((vehicle) =>
        validCoordinates(vehicle.position)
      ),
    [trackedVehicles]
  );

  const activeGroup = isBusiness && (groupFilter === "ungrouped" ||
    trackedVehicles.some((vehicle) => vehicle.groupId === groupFilter)) ? groupFilter : "";
  const activeGps = isBusiness ? gpsFilter : "";
  const activePosition = isBusiness && !positionError ? positionFilter : "";
  const hasFleetFilters = Boolean(activeGroup || activeGps || activePosition);
  const fleetVehicles = useMemo(() => trackedVehicles.filter((vehicle) => (
    (!activeGroup || (vehicle.groupId ?? "ungrouped") === activeGroup) &&
    (!activeGps || (vehicle.gpsStatus || "unknown") === activeGps) &&
    (!activePosition || validCoordinates(vehicle.position) === (activePosition === "located"))
  )), [trackedVehicles, activeGroup, activeGps, activePosition]);

  const locatedVehicles = useMemo(
    () => hasFleetFilters ? fleetVehicles.filter((vehicle) => validCoordinates(vehicle.position)) : allLocatedVehicles,
    [fleetVehicles, allLocatedVehicles, hasFleetFilters]
  );

  const filteredVehicles = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return fleetVehicles;
    }

    return fleetVehicles.filter((vehicle) =>
      [
        vehicle.name,
        vehicle.registrationNumber,
        vehicle.make,
        vehicle.model,
        vehicle.fleetNumber,
        vehicle.groupName,
        vehicle.driverName,
      ].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(query)
      )
    );
  }, [fleetVehicles, search]);

  const selectedVehicle = fleetVehicles.find(
    (vehicle) =>
      String(vehicle.id) === String(selectedId)
  );

  const selectedHasPosition = validCoordinates(
    selectedVehicle?.position
  );

  const selectVehicle = useCallback((vehicle) => {
    setSelectedId(vehicle.id);

    if (validCoordinates(vehicle.position)) {
      setFocusRequest((current) => current + 1);
    }
  }, []);

  const handleShowAll = () => {
    setShowAllRequest((current) => current + 1);
  };

  const handleRecenter = () => {
    if (!selectedHasPosition) {
      return;
    }

    setFocusRequest((current) => current + 1);
  };

  const toggleMapType = () => {
    setMapType((current) =>
      current === "street"
        ? "satellite"
        : "street"
    );
  };

  return (
    <TenantLayout title={labels.layoutTitle}>
      <main className="mx-auto max-w-[108rem] px-4 py-5 sm:px-7 sm:py-7">
        <PageHeader title={labels.heading} description={labels.description} compact>
          <button
            type="button"
            onClick={() => loadTracking()}
            disabled={loading || refreshing}
            className="control"
          >
            <RefreshCw
              size={17}
              className={
                refreshing ? "animate-spin" : ""
              }
            />
            Refresh
          </button>
        </PageHeader>

        {/* Errors */}
        {error && (
          <div
            role="alert"
            className="mb-6 flex items-center gap-3 rounded-xl border border-negative-line bg-negative-soft p-4 text-sm text-negative"
          >
            <CircleAlert size={18} />
            {error}
          </div>
        )}

        {/* Statistics */}
        <div className="mb-4 grid grid-cols-3 gap-2 sm:gap-3">
          {[
            [
              labels.totalVehicles,
              vehicles.length,
            ],
            [
              "With GPS Position",
              positionError ? "—" : allLocatedVehicles.length,
            ],
            [
              "Without GPS Position",
              positionError ? "—" : vehicles.length - allLocatedVehicles.length,
            ],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-panel border border-line bg-panel px-3 py-2 shadow-panel sm:flex sm:items-center sm:justify-between"
            >
              <p className="text-xs text-muted sm:text-sm">
                {label}
              </p>

              <p className="text-xl font-semibold tabular-nums">
                {loading || error ? "—" : value}
              </p>
            </div>
          ))}
        </div>

        {positionError && <p role="status" className="mb-4 text-sm text-caution">{positionError}</p>}
        {/* Vehicle List + Map */}
        <div className={`grid items-start gap-4 ${listOpen ? "xl:grid-cols-[minmax(0,1fr)_minmax(17rem,21rem)]" : ""}`}>
          {/* Map */}
          <section className="min-w-0 overflow-hidden rounded-panel border border-line bg-panel shadow-panel">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
              <div className="flex items-center gap-2">
                <MapPin
                  size={18}
                  className="text-accent"
                />

                <h2 className="font-semibold">
                  {labels.mapTitle}
                </h2>
              </div>

              <span className="text-xs text-subtle">
                <Clock3
                  size={13}
                  className="mr-1 inline"
                />
                15-second refresh
              </span>
            </div>

            {/* Map Controls */}
            <div className="fleet-map-toolbar flex flex-wrap items-center gap-2 border-b border-line p-2.5">
              <button
                type="button"
                onClick={handleShowAll}
                disabled={locatedVehicles.length === 0}
                className="control"
              >
                <Users size={15} />
                Show All
              </button>

              <button
                type="button"
                onClick={handleRecenter}
                disabled={!selectedHasPosition}
                className="control"
              >
                <Crosshair size={15} />
                Recenter
              </button>

              <button
                type="button"
                onClick={toggleMapType}
                aria-label="Toggle map and satellite view"
                aria-pressed={mapType === "satellite"}
                className="control"
              >
                <Layers size={15} />

                {mapType === "street"
                  ? "Satellite"
                  : "Street Map"}
              </button>
              <button type="button" className="control" aria-controls="tracking-vehicle-panel" aria-expanded={listOpen}
                onClick={() => setListOpen((current) => !current)}>
                {listOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
                {listOpen ? "Hide vehicles" : "Show vehicles"}
              </button>

              <span className="ml-auto text-xs text-subtle">
                {positionError ? "GPS unavailable" : `${locatedVehicles.length} located`}
              </span>
              {selectedVehicle && <span className="min-w-0 max-w-full truncate rounded-lg bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent"
                title={getVehicleName(selectedVehicle)}>{getVehicleName(selectedVehicle)}</span>}
            </div>

            {/* Leaflet Map */}
            <div className="fleet-map relative isolate h-[clamp(19rem,53dvh,46rem)] xl:h-[clamp(34rem,68dvh,64rem)]" data-layer={mapType}>
              <MapContainer
                center={DEFAULT_CENTER}
                zoom={11}
                scrollWheelZoom
                className="h-full w-full"
              >
                {mapType === "street" ? (
                  <TileLayer
                    key="street"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url={STREET_TILES}
                  />
                ) : (
                  <TileLayer
                    key="satellite"
                    attribution="Tiles &copy; Esri and its imagery providers"
                    url={SATELLITE_TILES}
                    maxZoom={19}
                  />
                )}

                <MapController
                  locatedVehicles={locatedVehicles}
                  selectedVehicle={selectedVehicle}
                  focusRequest={focusRequest}
                  showAllRequest={showAllRequest}
                />

                {locatedVehicles.map((vehicle) => <VehicleMarker key={vehicle.id} vehicle={vehicle}
                  selected={selectedVehicle?.id === vehicle.id} onSelect={selectVehicle} />)}
              </MapContainer>

              {!loading &&
                !error &&
                locatedVehicles.length === 0 && (
                  <div className="pointer-events-none absolute bottom-5 left-1/2 z-[500] w-[90%] max-w-md -translate-x-1/2 rounded-xl border border-line bg-panel p-4 text-center text-sm text-secondary shadow-xl">
                    {positionError || (hasFleetFilters ? "No GPS positions match the selected filters." : labels.noPositions)}
                  </div>
                )}
            </div>
          </section>
          {/* Sidebar */}
          <div id="tracking-vehicle-panel" className={listOpen ? "min-w-0" : "hidden"}>
            <section className="overflow-hidden rounded-panel border border-line bg-panel shadow-panel">
              <div className="border-b border-line p-3.5">
                <h2 className="mb-2 font-semibold">{labels.vehicleList}</h2>
                <SearchField label="Search tracking vehicles" placeholder={labels.searchPlaceholder} value={search} onChange={setSearch} />
                {isBusiness && (
                  <div className="mt-3 grid gap-2">
                    <FleetGroupFilter vehicles={trackedVehicles} value={activeGroup} onChange={setGroupFilter} />
                    <select aria-label="GPS status" value={gpsFilter} onChange={(event) => setGpsFilter(event.target.value)}
                      className="field-control">
                      <option value="">All GPS statuses</option>
                      <option value="online">Online</option>
                      <option value="offline">Offline</option>
                      <option value="unknown">Unknown</option>
                    </select>
                    <select aria-label="Position availability" value={positionFilter} disabled={Boolean(positionError)}
                      onChange={(event) => setPositionFilter(event.target.value)}
                      className="field-control disabled:opacity-50">
                      <option value="">All vehicle locations</option>
                      <option value="located">With GPS position</option>
                      <option value="missing">Without GPS position</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="max-h-[22rem] overflow-y-auto p-2.5 xl:max-h-[47dvh]">
                {loading ? (
                  <StateNotice loading>Loading vehicles…</StateNotice>
                ) : error ? (
                  <p className="py-12 text-center text-sm text-subtle">
                    Unable to display vehicles.
                    Try Refresh.
                  </p>
                ) : filteredVehicles.length === 0 ? (
                  <p className="py-12 px-3 text-center text-sm text-subtle">
                    {hasFleetFilters
                      ? "No vehicles match your filters."
                      : search.trim() ? labels.noSearchResults : labels.emptyVehicles}
                  </p>
                ) : (
                  filteredVehicles.map((vehicle) => (
                    <VehicleListItem
                      key={vehicle.id}
                      vehicle={vehicle}
                      selected={
                        String(selectedId) ===
                        String(vehicle.id)
                      }
                      onSelect={() =>
                        selectVehicle(vehicle)
                      }
                    />
                  ))
                )}
              </div>
            </section>

            {/* Selected Vehicle Preview */}
            {selectedVehicle && (
              <SelectedVehicleDetails
                vehicle={selectedVehicle}
                showOperations={isBusiness}
                positionError={positionError}
              />
            )}
          </div>

        </div>
      </main>
    </TenantLayout>
  );
}
