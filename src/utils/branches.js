export const getBranchDisplayName = (branch = {}) =>
    branch?.name ||
    branch?.nombre ||
    branch?.branchName ||
    branch?.tienda ||
    branch?.storeName ||
    '';

export const getBranchCode = (branch = {}) =>
    branch?.code ||
    branch?.codigo ||
    branch?.branchCode ||
    '';

export const getBranchIsActive = (branch = {}) => {
    if (typeof branch?.isActive === 'boolean') return branch.isActive;
    if (typeof branch?.active === 'boolean') return branch.active;
    if (typeof branch?.activa === 'boolean') return branch.activa;
    return true;
};

export const normalizeBranch = (branch = {}) => {
    const name = getBranchDisplayName(branch);
    const code = getBranchCode(branch);
    const isActive = getBranchIsActive(branch);

    return {
        ...branch,
        name,
        code,
        isActive,
        active: isActive
    };
};
