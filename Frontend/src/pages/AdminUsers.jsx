import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { 
  Plus, Edit, Trash2, User, UserPlus, X, Check, AlertCircle, RefreshCw 
} from "lucide-react";
import { API_URL } from "../lib/masterCodeCatalog";

const ROLES = [
  "engineer", "line_leader", "supervisor", "soporte_it",
  "skyrina", "planner", "master", "quality_inspector", "inspector",
  "merchant", "admin"
];

export default function AdminUsers() {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  // Form states for create/update
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [formData, setFormData] = useState({
    username: "",
    password: "",
    role: "line_leader",
    line_number: "",
    full_name: "",
  });

  // Load users
  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_URL}/api/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        if (res.status === 401) {
          localStorage.removeItem("token");
          navigate("/login");
          return;
        }
        throw new Error("Failed to fetch users");
      }
      const data = await res.json();
      if (data.success) {
        setUsers(data.users);
      } else {
        throw new Error(data.error || "Unknown error");
      }
    } catch (err) {
      setError(err.message);
      showToast("❌ Error cargando usuarios", true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const showToast = (msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3000);
  };

  // Create user
  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem("token");
      const payload = {
        username: formData.username,
        password: formData.password,
        role: formData.role,
        full_name: formData.full_name,
        line_number: formData.role === "line_leader" ? parseInt(formData.line_number) : null,
      };
      const res = await fetch(`${API_URL}/api/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error creating user");
      showToast(`✅ Usuario ${data.user.username} creado`);
      resetForm();
      fetchUsers();
    } catch (err) {
      showToast(`❌ ${err.message}`, true);
    }
  };

  // Update user
  const handleUpdate = async (e) => {
    e.preventDefault();
    if (!editingUser) return;
    try {
      const token = localStorage.getItem("token");
      const payload = {
        username: formData.username,
        role: formData.role,
        full_name: formData.full_name,
        line_number: formData.role === "line_leader" ? parseInt(formData.line_number) : null,
      };
      if (formData.password) payload.password = formData.password;

      const res = await fetch(`${API_URL}/api/users/${editingUser.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error updating user");
      showToast(`✅ Usuario ${data.user.username} actualizado`);
      resetForm();
      fetchUsers();
    } catch (err) {
      showToast(`❌ ${err.message}`, true);
    }
  };

  // Delete user
  const handleDelete = async (userId, username) => {
    if (!window.confirm(`¿Eliminar (desactivar) al usuario ${username}?`)) return;
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_URL}/api/users/${userId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error deleting user");
      showToast(`✅ Usuario ${username} desactivado`);
      fetchUsers();
    } catch (err) {
      showToast(`❌ ${err.message}`, true);
    }
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingUser(null);
    setFormData({
      username: "",
      password: "",
      role: "line_leader",
      line_number: "",
      full_name: "",
    });
  };

  const startEdit = (user) => {
    setEditingUser(user);
    setFormData({
      username: user.username,
      password: "", // leave blank to keep current password
      role: user.role,
      line_number: user.line_number || "",
      full_name: user.full_name || "",
    });
    setShowForm(true);
  };

  const startCreate = () => {
    setEditingUser(null);
    setFormData({
      username: "",
      password: "",
      role: "line_leader",
      line_number: "",
      full_name: "",
    });
    setShowForm(true);
  };

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Gestión de Usuarios</h1>
            <p className="text-sm text-slate-500">Administra los usuarios del sistema</p>
          </div>
          <button
            onClick={startCreate}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 text-white px-4 py-2 text-sm font-semibold hover:bg-slate-700 transition"
          >
            <UserPlus size={18} />
            Nuevo usuario
          </button>
        </div>

        {/* Toast */}
        {toast && (
          <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 text-sm px-4 py-2 rounded-full shadow-lg flex items-center gap-2
            ${toast.isError ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white'}`}
          >
            {toast.isError ? <AlertCircle size={14} /> : <Check size={14} className="text-emerald-400" />}
            {toast.msg}
          </div>
        )}

        {/* Form Modal */}
        {showForm && (
          <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">
                  {editingUser ? "Editar usuario" : "Crear usuario"}
                </h2>
                <button onClick={resetForm} className="p-1 hover:bg-slate-100 rounded">
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={editingUser ? handleUpdate : handleCreate}>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide">Usuario</label>
                    <input
                      type="text"
                      required
                      value={formData.username}
                      onChange={(e) => setFormData({...formData, username: e.target.value})}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide">
                      Contraseña {editingUser && "(dejar en blanco para no cambiar)"}
                    </label>
                    <input
                      type="password"
                      value={formData.password}
                      onChange={(e) => setFormData({...formData, password: e.target.value})}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide">Nombre completo</label>
                    <input
                      type="text"
                      value={formData.full_name}
                      onChange={(e) => setFormData({...formData, full_name: e.target.value})}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide">Rol</label>
                    <select
                      value={formData.role}
                      onChange={(e) => setFormData({...formData, role: e.target.value})}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                    >
                      {ROLES.map(r => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </div>
                  {formData.role === "line_leader" && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide">Número de línea</label>
                      <input
                        type="number"
                        min="1"
                        max="26"
                        value={formData.line_number}
                        onChange={(e) => setFormData({...formData, line_number: e.target.value})}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                      />
                    </div>
                  )}
                </div>
                <div className="flex justify-end gap-3 mt-6">
                  <button type="button" onClick={resetForm} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 rounded-lg">
                    Cancelar
                  </button>
                  <button type="submit" className="px-4 py-2 text-sm font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-700">
                    {editingUser ? "Actualizar" : "Crear"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Users Table */}
        {loading ? (
          <div className="text-center py-20 text-slate-400">
            <RefreshCw size={24} className="animate-spin mx-auto mb-2" />
            Cargando usuarios...
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-center">
            <p>{error}</p>
            <button onClick={fetchUsers} className="mt-2 text-sm underline">Reintentar</button>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">Usuario</th>
                  <th className="px-4 py-3">Nombre</th>
                  <th className="px-4 py-3">Rol</th>
                  <th className="px-4 py-3">Línea</th>
                  <th className="px-4 py-3">Activo</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">{user.id}</td>
                    <td className="px-4 py-2 font-medium text-slate-800">{user.username}</td>
                    <td className="px-4 py-2 text-slate-600">{user.full_name || "—"}</td>
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                        {user.role}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-slate-600">{user.line_number || "—"}</td>
                    <td className="px-4 py-2">
                      {user.is_active ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600">
                          <Check size={14} /> Activo
                        </span>
                      ) : (
                        <span className="text-rose-600">Inactivo</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => startEdit(user)}
                          className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700"
                          title="Editar"
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(user.id, user.username)}
                          className="p-1.5 rounded hover:bg-rose-50 text-slate-500 hover:text-rose-600"
                          title="Eliminar"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan="7" className="px-4 py-8 text-center text-slate-400">
                      No hay usuarios registrados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}