import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Link } from "react-router-dom";

import {
  Check,
  CircleAlert,
  ImagePlus,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Truck,
  Upload,
  X,
} from "lucide-react";

import TenantLayout from "../components/TenantLayout";
import FleetGroupFilter from "../components/FleetGroupFilter";
import VehicleOperations from "../components/VehicleOperations";
import VehicleGpsInstallation from "../components/VehicleGpsInstallation";
import { Modal, PageHeader } from "../components/WorkspaceUi";
import { useAuth } from "../context/AuthContext";
import { tenantApi } from "../services/api";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const EMPTY_FORM = {
  name: "",
  registrationNumber: "",
  make: "",
  model: "",
  traccarDeviceId: "",
  status: "active",
};

const inputClass =
  "w-full rounded-xl border border-line bg-field px-4 py-3 text-sm text-ink outline-none placeholder:text-subtle focus:border-accent-line";

function getErrorMessage(error, fallback) {
  return (
    error.response?.data?.message ||
    error.message ||
    fallback
  );
}

function StatusBadge({ value, type = "vehicle" }) {
  const status = String(value || "unknown").toLowerCase();

  let style = "bg-hover text-muted";

  if (status === "active" || status === "online") {
    style = "bg-positive-soft text-positive";
  } else if (
    status === "offline" ||
    status === "inactive"
  ) {
    style =
      type === "gps"
        ? "bg-caution-soft text-caution"
        : "bg-hover text-muted";
  }

  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold capitalize ${style}`}
    >
      {status}
    </span>
  );
}

function FormField({
  label,
  required = false,
  children,
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-secondary">
        {label}
        {required && (
          <span className="ml-1 text-negative">*</span>
        )}
      </span>
      {children}
    </label>
  );
}

// Images require Bearer authentication.
// Fetch the image as a Blob instead of using
// the database imageUrl directly in an img tag.
function VehicleImage({
  vehicleId,
  imageUrl,
  className = "",
}) {
  const [source, setSource] = useState(null);

  useEffect(() => {
    if (!vehicleId || !imageUrl) {
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

        if (cancelled) {
          return;
        }

        objectUrl = URL.createObjectURL(response.data);
        setSource(objectUrl);
      } catch {
        if (!cancelled) {
          setSource(null);
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
  }, [vehicleId, imageUrl]);

  if (!imageUrl || !source) {
    return (
      <div
        className={`flex items-center justify-center bg-accent-soft text-accent ${className}`}
      >
        <Truck size={24} />
      </div>
    );
  }

  return (
    <img
      src={source}
      alt="Vehicle"
      className={`object-cover ${className}`}
    />
  );
}

export default function VehiclesPage() {
  const { session } = useAuth();

  const profile = session?.profile;
  const role = profile?.role;
  const isPersonal = profile?.customerType === "personal";
  const isBusiness = profile?.customerType === "business";
  const labels = isPersonal
    ? {
        layoutTitle: "My Vehicles",
        eyebrow: "Personal Vehicle Tracking",
        heading: "My Vehicles",
        description: "View and manage your vehicles, GPS trackers, and vehicle photos.",
        directoryTitle: "My Vehicle Directory",
        searchPlaceholder: "Search my vehicles...",
        emptyMessage: "You haven't added any vehicles yet. Contact SNA Technologies to register your first vehicle and start tracking.",
        noDevicesMessage: "No unused GPS devices are allocated to your account. Contact SNA Technologies.",
      }
    : {
        layoutTitle: "Vehicle Management",
        eyebrow: "Fleet Operations",
        heading: "Company Vehicles",
        description: "View vehicles, manage GPS tracker associations, and upload vehicle photos.",
        directoryTitle: "Vehicle Directory",
        searchPlaceholder: "Search fleet vehicles...",
        emptyMessage: "No vehicles registered for your company yet.",
        noDevicesMessage: "No unused GPS devices are allocated to your company. Contact your platform administrator.",
      };

  const canManage =
    role === "tenant_admin" ||
    role === "manager";

  const [vehicles, setVehicles] = useState([]);
  const [availableDevices, setAvailableDevices] =
    useState([]);

  const [loading, setLoading] = useState(true);
  const [devicesLoading, setDevicesLoading] =
    useState(false);
  const [saving, setSaving] = useState(false);
  const [removingImage, setRemovingImage] =
    useState(false);

  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("default");
  const [vehiclePage, setVehiclePage] = useState(0);
  const [groupFilter, setGroupFilter] = useState("");
  const [operationsId, setOperationsId] = useState(null);
  const [installationVehicle, setInstallationVehicle] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] =
    useState(null);

  const [form, setForm] = useState({
    ...EMPTY_FORM,
  });

  const [selectedImage, setSelectedImage] =
    useState(null);
  const [imageType, setImageType] =
    useState("photo");
  const [previewUrl, setPreviewUrl] =
    useState(null);

  const loadVehicles = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await tenantApi.get(
        "/vehicles"
      );

      if (!Array.isArray(response.data)) {
        throw new Error(
          "Unexpected vehicles API response"
        );
      }

      setVehicles(response.data);
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          "Unable to load vehicles"
        )
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVehicles();
  }, [loadVehicles]);

  // Release local image previews when replaced
  // or when the component unmounts.
  useEffect(() => {
    if (!selectedImage) {
      setPreviewUrl(null);
      return undefined;
    }

    const url = URL.createObjectURL(
      selectedImage
    );

    setPreviewUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [selectedImage]);

  const activeGroup = isBusiness && (groupFilter === "ungrouped" ||
    vehicles.some((vehicle) => vehicle.groupId === groupFilter)) ? groupFilter : "";
  const operationsVehicle = vehicles.find((vehicle) => vehicle.id === operationsId);

  const filteredVehicles = useMemo(() => {
    const query = search.trim().toLowerCase();

    const matches = vehicles.filter((vehicle) =>
      (!activeGroup || (vehicle.groupId ?? "ungrouped") === activeGroup) &&
      (!query || [
        vehicle.name,
        vehicle.registrationNumber,
        vehicle.make,
        vehicle.model,
        vehicle.traccarDeviceId,
        vehicle.id,
        vehicle.fleetNumber,
        vehicle.groupName,
        vehicle.driverName,
      ].some((value) =>
        String(value ?? "")
          .toLowerCase()
          .includes(query)
      ))
    );
    if (sort === "name") matches.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    if (sort === "status") matches.sort((a, b) => (a.gpsStatus ?? "").localeCompare(b.gpsStatus ?? ""));
    return matches;
  }, [vehicles, search, activeGroup, sort]);
  const pageSize = 15;
  const currentPage = Math.min(vehiclePage, Math.max(0, Math.ceil(filteredVehicles.length / pageSize) - 1));
  const displayedVehicles = filteredVehicles.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  const loadAvailableDevices = async () => {
    setDevicesLoading(true);
    setFormError("");

    try {
      const response = await tenantApi.get(
        "/vehicles/available-devices"
      );

      if (!Array.isArray(response.data)) {
        throw new Error(
          "Unexpected GPS devices API response"
        );
      }

      setAvailableDevices(response.data);
    } catch (err) {
      setAvailableDevices([]);

      setFormError(
        getErrorMessage(
          err,
          "Unable to load available GPS devices"
        )
      );
    } finally {
      setDevicesLoading(false);
    }
  };

  const resetImageSelection = () => {
    setSelectedImage(null);
    setImageType("photo");
  };

  const openAddModal = () => {
    if (!canManage) return;

    setEditingVehicle(null);
    setForm({ ...EMPTY_FORM });
    setFormError("");
    setSuccess("");
    setAvailableDevices([]);
    resetImageSelection();
    setModalOpen(true);

    loadAvailableDevices();
  };

  const openEditModal = (vehicle) => {
    if (!canManage) return;

    setEditingVehicle(vehicle);

    setForm({
      name: vehicle.name || "",
      registrationNumber:
        vehicle.registrationNumber || "",
      make: vehicle.make || "",
      model: vehicle.model || "",
      traccarDeviceId: String(
        vehicle.traccarDeviceId || ""
      ),
      status: vehicle.status || "active",
    });

    setImageType(
      vehicle.imageType || "photo"
    );

    setSelectedImage(null);
    setFormError("");
    setSuccess("");
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving || removingImage) return;

    setModalOpen(false);
    setEditingVehicle(null);
    setFormError("");
    resetImageSelection();
  };

  const updateField = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleImageSelection = (event) => {
    const file = event.target.files?.[0];

    if (!file) return;

    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
    ];

    if (!allowedTypes.includes(file.type)) {
      setFormError(
        "Please select a JPG, PNG, or WebP image."
      );
      event.target.value = "";
      return;
    }

    if (file.size > MAX_IMAGE_SIZE) {
      setFormError(
        "Vehicle image must be 5 MB or smaller."
      );
      event.target.value = "";
      return;
    }

    setSelectedImage(file);
    setFormError("");
    event.target.value = "";
  };

  const uploadVehicleImage = async (
    vehicleId,
    file
  ) => {
    const data = new FormData();

    data.append("image", file);
    data.append("imageType", imageType);

    await tenantApi.post(
      `/vehicles/${vehicleId}/image`,
      data,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      }
    );
  };

  const handleRemoveImage = async () => {
    if (
      !editingVehicle ||
      !editingVehicle.imageUrl ||
      removingImage ||
      saving
    ) {
      return;
    }

    setRemovingImage(true);
    setFormError("");

    try {
      await tenantApi.delete(
        `/vehicles/${editingVehicle.id}/image`
      );

      setEditingVehicle((current) => ({
        ...current,
        imageUrl: null,
        imageType: null,
      }));

      setVehicles((current) =>
        current.map((vehicle) =>
          String(vehicle.id) ===
          String(editingVehicle.id)
            ? {
                ...vehicle,
                imageUrl: null,
                imageType: null,
              }
            : vehicle
        )
      );

      resetImageSelection();
      setSuccess(
        "Vehicle image removed successfully."
      );
    } catch (err) {
      setFormError(
        getErrorMessage(
          err,
          "Unable to remove vehicle image"
        )
      );
    } finally {
      setRemovingImage(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!canManage || saving) return;

    setSaving(true);
    setFormError("");
    setSuccess("");

    let savedVehicleId = null;

    try {
      if (editingVehicle) {
        const response = await tenantApi.patch(
          `/vehicles/${editingVehicle.id}`,
          {
            name: form.name.trim(),
            registrationNumber:
              form.registrationNumber.trim() ||
              null,
            make: form.make.trim() || null,
            model: form.model.trim() || null,
            status: form.status,
          }
        );

        savedVehicleId = response.data.id;
      } else {
        const response = await tenantApi.post(
          "/vehicles",
          {
            name: form.name.trim(),
            registrationNumber:
              form.registrationNumber.trim() ||
              null,
            make: form.make.trim() || null,
            model: form.model.trim() || null,
            traccarDeviceId:
              form.traccarDeviceId || null,
          }
        );

        savedVehicleId = response.data.id;
      }

      if (selectedImage) {
        try {
          await uploadVehicleImage(
            savedVehicleId,
            selectedImage
          );
        } catch (uploadError) {
          setFormError(
            `Vehicle details were saved, but image upload failed: ${getErrorMessage(
              uploadError,
              "Unknown upload error"
            )}`
          );

          await loadVehicles();
          return;
        }
      }

      setSuccess(
        editingVehicle
          ? "Vehicle updated successfully."
          : "Vehicle created successfully."
      );

      setModalOpen(false);
      setEditingVehicle(null);
      resetImageSelection();

      await loadVehicles();
    } catch (err) {
      setFormError(
        getErrorMessage(
          err,
          "Unable to save vehicle"
        )
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <TenantLayout title={labels.layoutTitle}>
      <main className="mx-auto max-w-screen-2xl px-4 py-5 sm:px-7 sm:py-7">
        <PageHeader title={labels.heading} description={labels.description}>
          <div className="flex flex-wrap items-center gap-3">
            <Link to="/devices" className="rounded-xl border border-line bg-panel px-4 py-3 text-sm text-secondary">
              Device connectivity
            </Link>
            <button
              type="button"
              onClick={loadVehicles}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-line bg-panel px-4 py-3 text-sm font-medium text-secondary transition hover:bg-hover disabled:opacity-50"
            >
              <RefreshCw
                size={17}
                className={
                  loading ? "animate-spin" : ""
                }
              />
              Refresh
            </button>

            {canManage && (
              <button
                type="button"
                onClick={openAddModal}
                className="inline-flex items-center gap-2 rounded-xl bg-action px-4 py-3 text-sm font-semibold transition hover:bg-action-hover"
              >
                <Plus size={18} />
                Add Vehicle
              </button>
            )}
          </div>
        </PageHeader>

        {success && (
          <div
            role="status"
            className="mb-6 flex items-center gap-3 rounded-xl border border-positive-line bg-positive-soft p-4 text-sm text-positive"
          >
            <Check size={18} />
            {success}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mb-6 flex items-center gap-3 rounded-xl border border-negative-line bg-negative-soft p-4 text-sm text-negative"
          >
            <CircleAlert size={18} />
            {error}
          </div>
        )}

        <section className="overflow-hidden rounded-panel border border-line bg-panel shadow-panel">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line p-6">
            <div>
              <h3 className="text-lg font-bold">
                {labels.directoryTitle}
              </h3>

              <p className="mt-1 text-sm text-subtle">
                {vehicles.length} registered vehicles
              </p>
            </div>

            {isBusiness && (
              <div className="w-full sm:w-52">
                <FleetGroupFilter vehicles={vehicles} value={activeGroup} onChange={(value) => { setGroupFilter(value); setVehiclePage(0); }} />
              </div>
            )}
            <label className="w-full sm:w-40">
              <span className="sr-only">Sort vehicles</span>
              <select className="field-control" value={sort} onChange={(event) => { setSort(event.target.value); setVehiclePage(0); }}>
                <option value="default">Default order</option><option value="name">Name A–Z</option><option value="status">GPS status</option>
              </select>
            </label>
            <div className="relative w-full sm:w-72">
              <Search
                size={17}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle"
              />

              <input
                type="search"
                value={search}
                onChange={(event) => { setSearch(event.target.value); setVehiclePage(0); }}
                aria-label="Search vehicles"
                placeholder={labels.searchPlaceholder}
                className={`${inputClass} pl-10`}
              />
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-3 py-20 text-muted">
              <LoaderCircle
                size={22}
                className="animate-spin"
              />
              Loading vehicles...
            </div>
          ) : error ? (
            <div className="py-20 text-center text-sm text-subtle">
              Unable to display vehicles.
              Try refreshing.
            </div>
          ) : filteredVehicles.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-20 text-center">
              <Truck
                size={35}
                className="text-subtle"
              />

              <p className="text-sm text-muted">
                {activeGroup
                  ? "No vehicles match your filters."
                  : search ? "No vehicles match your search." : labels.emptyMessage}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left">
                <thead className="bg-hover text-xs uppercase tracking-wider text-subtle">
                  <tr>
                    {[
                      "Vehicle",
                      "Registration",
                      "GPS Device",
                      "GPS Status",
                      "Vehicle Status",
                      "Actions",
                    ].map((heading) => (
                      <th
                        key={heading}
                        className="px-6 py-4 font-semibold"
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {displayedVehicles.map((vehicle) => (
                    <tr
                      key={vehicle.id}
                      className="border-t border-line transition hover:bg-hover"
                    >
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-3">
                          <VehicleImage
                            vehicleId={vehicle.id}
                            imageUrl={vehicle.imageUrl}
                            className="h-14 w-20 shrink-0 rounded-xl"
                          />

                          <div>
                            <p className="font-semibold">
                              {vehicle.name ||
                                `Vehicle ${vehicle.id}`}
                            </p>
                            {isBusiness && (vehicle.groupName || vehicle.driverName) && (
                              <p className="mt-1 text-xs text-muted">
                                {[vehicle.groupName, vehicle.driverName].filter(Boolean).join(" · ")}
                              </p>
                            )}

                            <p className="mt-1 text-xs text-subtle">
                              {[
                                vehicle.make,
                                vehicle.model,
                              ]
                                .filter(Boolean)
                                .join(" ") ||
                                "No model specified"}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-5 text-sm text-muted">
                        {vehicle.registrationNumber ||
                          "—"}
                      </td>

                      <td className="px-6 py-5 text-sm text-muted">
                        {vehicle.traccarDeviceId ? `#${vehicle.traccarDeviceId}` : "Not installed"}
                      </td>

                      <td className="px-6 py-5">
                        <StatusBadge
                          value={vehicle.gpsStatus}
                          type="gps"
                        />
                      </td>

                      <td className="px-6 py-5">
                        <StatusBadge
                          value={vehicle.status}
                        />
                      </td>

                      <td className="px-6 py-5">
                        {canManage && (
                          <button type="button" onClick={() => setInstallationVehicle(vehicle)}
                            aria-label={`GPS device for ${vehicle.name}`}
                            className="mr-2 rounded-lg border border-line px-3 py-2 text-xs text-secondary hover:bg-hover">
                            GPS device
                          </button>
                        )}
                        {isBusiness && (
                          <button type="button" onClick={() => setOperationsId(vehicle.id)}
                            aria-label={`Operations for ${vehicle.name}`}
                            className="mr-2 rounded-lg border border-line px-3 py-2 text-xs text-secondary hover:bg-hover">
                            Operations
                          </button>
                        )}
                        {canManage ? (
                          <button
                            type="button"
                            onClick={() =>
                              openEditModal(vehicle)
                            }
                            className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs text-secondary transition hover:bg-hover"
                          >
                            <Pencil size={14} />
                            Edit
                          </button>
                        ) : !isBusiness && (
                          <span className="text-xs text-subtle">
                            View only
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-xs text-subtle">
            <p>Showing {error ? 0 : displayedVehicles.length} of {error ? 0 : filteredVehicles.length} matching vehicles</p>
            {filteredVehicles.length > pageSize && <div className="flex flex-wrap gap-2">
              <button type="button" className="control" disabled={currentPage === 0} onClick={() => setVehiclePage(currentPage - 1)}>Previous</button>
              <button type="button" className="control" disabled={(currentPage + 1) * pageSize >= filteredVehicles.length}
                onClick={() => setVehiclePage(currentPage + 1)}>Next</button>
            </div>}
          </div>
        </section>
      </main>

      {modalOpen && (
        <Modal labelId="vehicle-modal-title" onClose={closeModal} busy={saving || removingImage}>
            <div className="flex items-center justify-between border-b border-line p-6">
              <div>
                <h3
                  id="vehicle-modal-title"
                  className="text-xl font-bold"
                >
                  {editingVehicle
                    ? "Edit Vehicle"
                    : "Add Vehicle"}
                </h3>

                <p className="mt-1 text-sm text-subtle">
                  {editingVehicle
                    ? "Update vehicle information and image."
                    : "Register a vehicle using an allocated GPS device."}
                </p>
              </div>

              <button
                type="button"
                onClick={closeModal}
                disabled={saving || removingImage}
                aria-label="Close form"
                className="text-muted hover:text-ink disabled:opacity-50"
              >
                <X size={22} />
              </button>
            </div>

            <form
              onSubmit={handleSubmit}
              className="max-h-[75vh] space-y-5 overflow-y-auto p-6"
            >
              {formError && (
                <div
                  role="alert"
                  className="rounded-xl border border-negative-line bg-negative-soft p-3 text-sm text-negative"
                >
                  {formError}
                </div>
              )}

              <FormField
                label="Vehicle Name"
                required
              >
                <input
                  className={inputClass}
                  value={form.name}
                  onChange={(event) =>
                    updateField(
                      "name",
                      event.target.value
                    )
                  }
                  placeholder="e.g. Toyota Corolla"
                  maxLength={150}
                  required
                />
              </FormField>

              <FormField label="Registration Number">
                <input
                  className={inputClass}
                  value={form.registrationNumber}
                  onChange={(event) =>
                    updateField(
                      "registrationNumber",
                      event.target.value
                    )
                  }
                  placeholder="e.g. ABC-123"
                  maxLength={50}
                />
              </FormField>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Make">
                  <input
                    className={inputClass}
                    value={form.make}
                    onChange={(event) =>
                      updateField(
                        "make",
                        event.target.value
                      )
                    }
                    placeholder="Toyota"
                    maxLength={100}
                  />
                </FormField>

                <FormField label="Model">
                  <input
                    className={inputClass}
                    value={form.model}
                    onChange={(event) =>
                      updateField(
                        "model",
                        event.target.value
                      )
                    }
                    placeholder="Corolla"
                    maxLength={100}
                  />
                </FormField>
              </div>

              {editingVehicle ? (
                <>
                  <FormField label="GPS Device">
                    <input
                      className={`${inputClass} cursor-not-allowed opacity-60`}
                      value={form.traccarDeviceId ? `Device #${form.traccarDeviceId}` : "Not installed"}
                      disabled
                    />
                  </FormField>

                  <FormField label="Vehicle Status">
                    <select
                      className={inputClass}
                      value={form.status}
                      onChange={(event) =>
                        updateField(
                          "status",
                          event.target.value
                        )
                      }
                    >
                      <option value="active">
                        Active
                      </option>
                      <option value="inactive">
                        Inactive
                      </option>
                    </select>
                  </FormField>
                </>
              ) : (
                <FormField label="GPS Device (optional)">
                  <select
                    className={inputClass}
                    value={form.traccarDeviceId}
                    onChange={(event) =>
                      updateField(
                        "traccarDeviceId",
                        event.target.value
                      )
                    }
                    disabled={
                      devicesLoading ||
                      availableDevices.length === 0
                    }
                  >
                    <option value="">
                      {devicesLoading
                        ? "Loading GPS devices..."
                        : "No GPS device"}
                    </option>

                    {availableDevices.map((device) => (
                      <option
                        key={device.traccarDeviceId}
                        value={device.traccarDeviceId}
                      >
                        {device.deviceName} —{" "}
                        {device.uniqueId} (#
                        {device.traccarDeviceId})
                      </option>
                    ))}
                  </select>

                  {!devicesLoading &&
                    !formError &&
                    availableDevices.length === 0 && (
                      <p className="mt-2 text-xs text-caution">
                        {labels.noDevicesMessage}
                      </p>
                    )}
                </FormField>
              )}

              {/* Vehicle Image Section */}
              <div className="rounded-panel border border-line bg-field p-4">
                <div className="mb-4 flex items-center gap-2">
                  <ImagePlus
                    size={19}
                    className="text-accent"
                  />

                  <h4 className="text-sm font-semibold">
                    Vehicle Image
                  </h4>
                </div>

                <div className="mb-4 overflow-hidden rounded-xl border border-line">
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt="Selected vehicle preview"
                      className="h-44 w-full object-contain bg-black/20"
                    />
                  ) : editingVehicle?.imageUrl ? (
                    <VehicleImage
                      vehicleId={editingVehicle.id}
                      imageUrl={editingVehicle.imageUrl}
                      className="h-44 w-full"
                    />
                  ) : (
                    <div className="flex h-44 flex-col items-center justify-center gap-3 bg-hover text-subtle">
                      <Truck size={40} />
                      <p className="text-xs">
                        No vehicle image selected
                      </p>
                    </div>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-xs font-medium text-muted">
                      Image Type
                    </label>

                    <select
                      value={imageType}
                      onChange={(event) =>
                        setImageType(
                          event.target.value
                        )
                      }
                      disabled={saving || removingImage}
                      className={inputClass}
                    >
                      <option value="photo">
                        Real Photo
                      </option>

                      <option value="illustration">
                        Illustration
                      </option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 block text-xs font-medium text-muted">
                      Upload Image
                    </label>

                    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-accent-line bg-accent-soft px-4 py-3 text-sm text-accent transition hover:bg-accent-soft">
                      <Upload size={17} />

                      {selectedImage
                        ? "Change Image"
                        : "Choose Image"}

                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={handleImageSelection}
                        disabled={saving || removingImage}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>

                {selectedImage && (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-hover px-3 py-2">
                    <p className="truncate text-xs text-secondary">
                      {selectedImage.name}
                    </p>

                    <button
                      type="button"
                      onClick={() =>
                        setSelectedImage(null)
                      }
                      disabled={saving}
                      aria-label="Clear selected image"
                      className="text-muted hover:text-ink"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}

                {editingVehicle?.imageUrl &&
                  !selectedImage && (
                    <button
                      type="button"
                      onClick={handleRemoveImage}
                      disabled={
                        saving || removingImage
                      }
                      className="mt-3 inline-flex items-center gap-2 text-xs text-negative hover:text-negative disabled:opacity-50"
                    >
                      {removingImage ? (
                        <LoaderCircle
                          size={15}
                          className="animate-spin"
                        />
                      ) : (
                        <Trash2 size={15} />
                      )}

                      Remove Current Image
                    </button>
                  )}

                <p className="mt-3 text-xs text-subtle">
                  JPG, PNG, or WebP. Maximum 5 MB.
                  Images are accessible only through
                  authenticated vehicle APIs.
                </p>
              </div>

              <div className="flex justify-end gap-3 border-t border-line pt-5">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving || removingImage}
                  className="rounded-xl border border-line px-5 py-3 text-sm text-secondary hover:bg-hover disabled:opacity-50"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={
                    saving || removingImage
                  }
                  className="inline-flex items-center gap-2 rounded-xl bg-action px-5 py-3 text-sm font-semibold hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving && (
                    <LoaderCircle
                      size={17}
                      className="animate-spin"
                    />
                  )}

                  {saving
                    ? "Saving..."
                    : editingVehicle
                      ? "Save Changes"
                      : "Create Vehicle"}
                </button>
              </div>
            </form>
        </Modal>
      )}
      {isBusiness && operationsVehicle && (
        <VehicleOperations key={operationsVehicle.id} vehicle={operationsVehicle} canManage={canManage}
          onClose={() => setOperationsId(null)} onSaved={loadVehicles} />
      )}
      {canManage && installationVehicle && (
        <VehicleGpsInstallation vehicle={installationVehicle}
          onClose={() => setInstallationVehicle(null)} onSaved={loadVehicles} />
      )}
    </TenantLayout>
  );
}
